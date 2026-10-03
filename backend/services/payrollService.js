/**
 * payrollService.js — orchestrates a payroll run end to end (MongoDB):
 *   parse + persist  ->  generate PDFs  ->  send emails (each to its own owner)
 *
 * Collections: PayrollBatch (the UI's "run"), Payslip (one per employee per
 * batch, holds the pay-advice snapshot), EmailLog (one per payslip, delivery
 * status), Employee (directory).
 *
 * Generation and sending run as in-process background jobs; the UI polls for
 * progress. A batch is never double-processed (in-flight guard), and each
 * email is claimed atomically before sending so it can't be sent twice by
 * overlapping jobs.
 *
 * API responses keep the original snake_case shape the frontend expects.
 */
const crypto = require('crypto');
const { mongoose } = require('../config/mongo');
const {
  PayrollBatch, Payslip, EmailLog, Employee,
} = require('../models');
const excel = require('./excelService');
const pdf = require('./pdfService');
const email = require('./emailService');
const audit = require('./auditService');
const emailCheck = require('../utils/emailCheck');
const logger = require('../utils/logger');
const {
  safeFilePart, isValidEmail, cleanText, MONTHS,
} = require('../utils/validators');

const { isValidObjectId, Types } = mongoose;
const env = require('../config/env');

const CONCURRENCY = env.JOB_CONCURRENCY; // PDF generation
const WORKER_ID = `${require('os').hostname()}:${process.pid}`;
const inFlight = new Set(); // batch ids currently being processed

const httpError = (status, message) => Object.assign(new Error(message), { status });
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** "june 2026" -> { label: "June 2026", key: "2026-06" } */
function parsePeriod(period) {
  const [m, y] = String(period).trim().split(/\s+/);
  const idx = MONTHS.findIndex((x) => x.toLowerCase() === m.toLowerCase());
  return { label: `${MONTHS[idx]} ${y}`, key: `${y}-${String(idx + 1).padStart(2, '0')}` };
}

/* --------------------------- status mapping ------------------------------ */

/**
 * Frontend status vocabulary (pending | generated | sending | sent | failed |
 * skipped) derived from the EmailLog status + whether the PDF was generated.
 */
function apiStatus(logStatus, generatedAt) {
  switch (logStatus) {
    case 'SENT': return 'sent';
    case 'FAILED': return 'failed';
    case 'SKIPPED': return 'skipped';
    case 'SENDING': return 'sending';
    default: return generatedAt ? 'generated' : 'pending';
  }
}

// Same mapping as an aggregation expression (log joined as `$log`).
const API_STATUS_EXPR = {
  $switch: {
    branches: [
      { case: { $eq: ['$log.status', 'SENT'] }, then: 'sent' },
      { case: { $eq: ['$log.status', 'FAILED'] }, then: 'failed' },
      { case: { $eq: ['$log.status', 'SKIPPED'] }, then: 'skipped' },
      { case: { $eq: ['$log.status', 'SENDING'] }, then: 'sending' },
      { case: { $ifNull: ['$generatedAt', false] }, then: 'generated' },
    ],
    default: 'pending',
  },
};

const EMPTY_COUNTS = () => ({
  sent: 0, failed: 0, pending: 0, generated: 0, generating: 0, sending: 0, skipped: 0,
});

/** Live delivery counts for one batch (frontend vocabulary). */
async function emailCounts(batchId) {
  const out = EMPTY_COUNTS();
  if (!isValidObjectId(batchId)) return out;
  const rows = await Payslip.aggregate([
    { $match: { batch: new Types.ObjectId(String(batchId)) } },
    { $lookup: { from: 'emaillogs', localField: '_id', foreignField: 'payslip', as: 'log' } },
    { $unwind: { path: '$log', preserveNullAndEmptyArrays: true } },
    { $group: { _id: API_STATUS_EXPR, c: { $sum: 1 } } },
  ]);
  rows.forEach((r) => { out[r._id] = r.c; });
  return out;
}

/** Sent / failed / skipped / generated totals for many batches (lists). */
async function batchTotals(batchIds) {
  const map = new Map(batchIds.map((id) => [String(id), { sent: 0, failed: 0, skipped: 0, pending: 0, sending: 0, generated: 0 }]));
  if (!batchIds.length) return map;
  const [logs, gens] = await Promise.all([
    EmailLog.aggregate([
      { $match: { batch: { $in: batchIds } } },
      { $group: { _id: { b: '$batch', s: '$status' }, c: { $sum: 1 } } },
    ]),
    Payslip.aggregate([
      { $match: { batch: { $in: batchIds }, generatedAt: { $ne: null } } },
      { $group: { _id: '$batch', c: { $sum: 1 } } },
    ]),
  ]);
  logs.forEach((r) => { const t = map.get(String(r._id.b)); if (t) t[r._id.s.toLowerCase()] = r.c; });
  gens.forEach((r) => { const t = map.get(String(r._id)); if (t) t.generated = r.c; });
  return map;
}

function toRunApi(b, totals, { withSummary = false } = {}) {
  const vs = b.validationSummary || {};
  const t = totals || {};
  const run = {
    id: String(b._id),
    period: b.periodLabel,
    period_key: b.periodKey,
    original_filename: b.originalFilename || null,
    uploaded_by: b.uploadedBy ? String(b.uploadedBy) : null,
    status: b.status,
    total_employees: vs.total || 0,
    valid_count: vs.valid || 0,
    invalid_count: vs.invalid || 0,
    generated_count: t.generated || 0,
    sent_count: t.sent || 0,
    failed_count: t.failed || 0,
    skipped_count: t.skipped || 0,
    pending_count: (t.pending || 0) + (t.sending || 0),
    created_at: b.createdAt,
    generated_at: b.generatedAt || null,
    sent_at: b.completedAt || null,
    jobActive: inFlight.has(String(b._id)),
  };
  if (withSummary) run.validation_summary = vs;
  return run;
}

/* ----------------------------- create / read ----------------------------- */

/** Mongoose validation errors → a 400 that names fields, never values. */
function asBadRequest(e) {
  if (e && e.name === 'ValidationError') {
    const fields = [...new Set(Object.keys(e.errors).map((k) => k.replace(/\.\d+/g, '')))].slice(0, 5);
    return httpError(400, `The file contains values that are too long or invalid (${fields.join(', ')}).`);
  }
  return e;
}

async function createRunFromUpload({
  user, buffer, filename, period, ip,
}) {
  const parsed = await excel.parseWorkbook(buffer);
  const p = parsePeriod(period);
  const fileSha256 = sha256(buffer);

  if (await PayrollBatch.exists({ periodKey: p.key, fileSha256 })) {
    throw httpError(409, `This exact file has already been uploaded for ${p.label}. Open the existing payroll run in Payroll History instead.`);
  }
  const samePeriod = await PayrollBatch.find({ periodKey: p.key }, { _id: 1 }).lean();
  if (samePeriod.some((b) => inFlight.has(String(b._id)))) {
    throw httpError(409, `Payroll for ${p.label} is being processed right now. Wait for it to finish, then upload again.`);
  }

  const now = new Date();
  let batch;
  let replaced = [];
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      // Re-upload for the same period (e.g. a corrected file):
      //  - nothing emailed yet  → the new file REPLACES the previous draft(s)
      //  - anything sent/sending → blocked (never silently overwrite delivered payroll)
      const previous = await PayrollBatch.find({ periodKey: p.key }, { _id: 1 }).session(session).lean();
      replaced = previous.map((b) => b._id);
      if (replaced.length) {
        const delivered = await EmailLog.countDocuments({ batch: { $in: replaced }, status: { $in: ['SENT', 'SENDING'] } }).session(session);
        if (delivered) {
          throw httpError(409, `Payroll for ${p.label} has already been emailed to ${delivered} employee(s), so it cannot be replaced. If this is a correction, contact the affected staff and upload it as a separate period only after agreeing the process with Payroll.`);
        }
        await EmailLog.deleteMany({ batch: { $in: replaced } }, { session });
        await Payslip.deleteMany({ batch: { $in: replaced } }, { session });
        await PayrollBatch.deleteMany({ _id: { $in: replaced } }, { session });
      }

      [batch] = await PayrollBatch.create([{
        periodKey: p.key,
        periodLabel: p.label,
        originalFilename: safeFilePart(filename || 'payroll.xlsx').slice(0, 255),
        fileSha256,
        uploadedBy: user.id,
        status: 'validated',
        legendDetected: !!parsed.legendDetected,
        validationSummary: parsed.summary,
        counts: {
          total: parsed.summary.total,
          valid: parsed.summary.valid,
          invalid: parsed.summary.invalid,
          pending: parsed.summary.valid,
          skipped: parsed.summary.invalid,
        },
      }], { session });

      // directory: upsert each valid employee by Employee ID
      const validRows = parsed.employees.filter((e) => e.valid && e.employeeId);
      if (validRows.length) {
        await Employee.bulkWrite(validRows.map((e) => ({
          updateOne: {
            filter: { employeeId: e.employeeId },
            update: {
              $set: {
                name: e.name,
                email: e.email,
                department: e.department,
                designation: e.designation,
                lastBatch: batch._id,
                lastSeenAt: now,
              },
            },
            upsert: true,
          },
        })), { session });
      }
      const dir = await Employee.find({ employeeId: { $in: validRows.map((e) => e.employeeId) } }, { employeeId: 1 })
        .session(session).lean();
      const empRef = new Map(dir.map((d) => [d.employeeId, d._id]));

      // Invalid rows may hold over-long values (that is WHY they are invalid);
      // store them truncated so the admin can still see and fix the row.
      const payslips = await Payslip.insertMany(parsed.employees.map((e) => ({
        batch: batch._id,
        employee: e.valid ? empRef.get(e.employeeId) : undefined,
        rowNumber: e.rowNumber,
        employeeId: clip(e.employeeId, 64),
        name: clip(e.name, 200),
        email: clip(e.email, 254),
        department: clip(e.department, 200),
        designation: clip(e.designation, 200),
        grossPay: e.grossPay,
        totalDeductions: e.totalDeductions,
        netPay: e.netPay,
        advice: clipAdvice(e.advice),
        valid: e.valid,
        issues: e.issues.slice(0, 50).map((i) => String(i).slice(0, 300)),
      })), { session });

      // one delivery record per payslip; invalid rows are SKIPPED with reason
      await EmailLog.insertMany(payslips.map((ps) => ({
        payslip: ps._id,
        batch: batch._id,
        employee: ps.employee,
        employeeId: ps.employeeId,
        employeeName: ps.name,
        email: ps.email,
        period: p.label,
        status: ps.valid ? 'PENDING' : 'SKIPPED',
        failureReason: ps.valid ? undefined : ps.issues.filter((i) => !i.includes('(warning)')).join('; ').slice(0, 500),
      })), { session });
    });
  } catch (e) {
    if (e && e.code === 11000 && /fileSha256/.test(e.message)) {
      throw httpError(409, `This exact file has already been uploaded for ${p.label}.`);
    }
    throw asBadRequest(e);
  } finally {
    await session.endSession();
  }

  // The uploaded workbook is NOT stored anywhere: it was parsed from memory
  // and is discarded with the request. Its SHA-256 is kept for integrity /
  // duplicate detection.

  if (replaced.length) {
    await audit.record({
      user, action: 'payroll.replaced', entity: 'payroll_run', entityId: batch.id, ip, details: { period: p.label, replacedRuns: replaced.map(String) },
    });
  }
  await audit.record({
    user,
    action: 'payroll.upload',
    entity: 'payroll_run',
    entityId: batch.id,
    ip,
    details: {
      period: p.label,
      filename: batch.originalFilename,
      sha256: fileSha256.slice(0, 16),
      total: parsed.summary.total,
      valid: parsed.summary.valid,
      invalid: parsed.summary.invalid,
      legendDetected: parsed.legendDetected,
    },
  });

  return {
    runId: batch.id,
    summary: parsed.summary,
    columns: parsed.columns,
    legendDetected: parsed.legendDetected,
    replacedRuns: replaced.length,
  };
}

const clip = (s, n) => {
  const v = String(s == null ? '' : s);
  return v.length > n ? `${v.slice(0, n - 1)}…` : v;
};
function clipAdvice(a) {
  return {
    ...a,
    employee: {
      name: clip(a.employee.name, 200),
      employeeId: clip(a.employee.employeeId, 64),
      department: clip(a.employee.department, 200),
      designation: clip(a.employee.designation, 200),
      bank: clip(a.employee.bank, 120),
      accountNo: clip(a.employee.accountNo, 40),
    },
    bankTax: { tin: clip(a.bankTax.tin, 40) },
    pension: {
      pfaName: clip(a.pension.pfaName, 200),
      pensionPin: clip(a.pension.pensionPin, 40),
      nhfNumber: clip(a.pension.nhfNumber, 40),
    },
  };
}

async function findBatch(batchId) {
  if (!isValidObjectId(batchId)) return null;
  return PayrollBatch.findById(batchId).lean();
}

async function getRun(batchId) {
  const b = await findBatch(batchId);
  if (!b) return null;
  const totals = (await batchTotals([b._id])).get(String(b._id));
  return toRunApi(b, totals, { withSummary: true });
}

async function listRuns() {
  const batches = await PayrollBatch.find().sort({ createdAt: -1 }).lean();
  const totals = await batchTotals(batches.map((b) => b._id));
  return batches.map((b) => toRunApi(b, totals.get(String(b._id))));
}

const STATUS_FILTERS = ['pending', 'generated', 'sending', 'sent', 'failed', 'skipped'];
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function getRunEmployees(batchId, {
  search = '', status = '', page = 1, pageSize = 25,
} = {}) {
  if (!isValidObjectId(batchId)) return { total: 0, page, pageSize, rows: [] };
  const match = { batch: new Types.ObjectId(String(batchId)) };
  if (status === 'valid') match.valid = true;
  else if (status === 'invalid') match.valid = false;
  if (search) {
    const rx = new RegExp(escapeRegex(search.slice(0, 100)), 'i');
    match.$or = [{ name: rx }, { employeeId: rx }, { department: rx }, { email: rx }];
  }

  const pipeline = [
    { $match: match },
    { $lookup: { from: 'emaillogs', localField: '_id', foreignField: 'payslip', as: 'log' } },
    { $unwind: { path: '$log', preserveNullAndEmptyArrays: true } },
    { $addFields: { email_status: API_STATUS_EXPR } },
  ];
  if (STATUS_FILTERS.includes(status)) pipeline.push({ $match: { email_status: status } });
  pipeline.push({
    $facet: {
      total: [{ $count: 'c' }],
      rows: [{ $sort: { rowNumber: 1 } }, { $skip: (page - 1) * pageSize }, { $limit: pageSize }],
    },
  });

  const [res] = await Payslip.aggregate(pipeline);
  return {
    total: res.total[0] ? res.total[0].c : 0,
    page,
    pageSize,
    rows: res.rows.map((r) => ({
      id: String(r._id),
      row_number: r.rowNumber,
      employee_id: r.employeeId,
      name: r.name,
      email: r.email,
      department: r.department,
      designation: r.designation,
      gross_pay: r.grossPay,
      total_deductions: r.totalDeductions,
      net_pay: r.netPay,
      valid: r.valid,
      issues: r.issues || [],
      email_status: r.email_status,
      email_error: r.log && r.log.status !== 'SKIPPED' ? r.log.failureReason || null : null,
      generated_at: r.generatedAt || null,
      sent_at: r.log ? r.log.sentAt || null : null,
    })),
  };
}

/** One payslip + its delivery record, in the frontend's employee shape. */
async function getEmployee(payslipId) {
  if (!isValidObjectId(payslipId)) return null;
  const p = await Payslip.findById(payslipId).lean();
  if (!p) return null;
  const log = await EmailLog.findOne({ payslip: p._id }).lean();
  return {
    id: String(p._id),
    run_id: String(p.batch),
    payslip_no: p.payslipNo,
    row_number: p.rowNumber,
    employee_id: p.employeeId,
    name: p.name,
    email: p.email,
    department: p.department,
    designation: p.designation,
    gross_pay: p.grossPay,
    total_deductions: p.totalDeductions,
    net_pay: p.netPay,
    valid: p.valid,
    issues: p.issues || [],
    advice: p.advice,
    email_status: apiStatus(log && log.status, p.generatedAt),
    email_error: log && log.status !== 'SKIPPED' ? log.failureReason || null : null,
    attempt_count: log ? log.attemptCount : 0,
    last_attempt_at: log ? log.lastAttemptAt || null : null,
    generated_at: p.generatedAt || null,
    sent_at: log ? log.sentAt || null : null,
  };
}

/** Render one payslip's PDF in memory (never written to disk). */
async function renderPayslip(p, periodLabel) {
  const buffer = await pdf.renderToBuffer(p.advice, periodLabel);
  return { buffer, filename: pdf.adviceFilename(p.advice.employee, periodLabel), sha: sha256(buffer) };
}

/* ------------------------------- generate -------------------------------- */

async function generateRun({ runId, user, ip }) {
  const batch = await findBatch(runId);
  if (!batch) throw httpError(404, 'Payroll run not found.');
  const key = String(batch._id);
  if (inFlight.has(key)) throw httpError(409, 'This run is already being processed.');

  await PayrollBatch.updateOne({ _id: batch._id }, { $set: { status: 'generating' } });
  await audit.record({
    user, action: 'payroll.generate.start', entity: 'payroll_run', entityId: key, ip, details: { period: batch.periodLabel },
  });

  runJob(key, async () => {
    const valid = await Payslip.find({ batch: batch._id, valid: true }, { advice: 1 }).lean();
    await mapWithConcurrency(valid, CONCURRENCY, async (p) => {
      try {
        const { sha } = await renderPayslip(p, batch.periodLabel);
        await Payslip.updateOne({ _id: p._id }, { $set: { generatedAt: new Date(), pdfSha256: sha } });
      } catch (e) {
        logger.error('generate_one_failed', { payslip: String(p._id), error: e.message });
      }
    });
    const generated = await Payslip.countDocuments({ batch: batch._id, generatedAt: { $ne: null } });
    await PayrollBatch.updateOne({ _id: batch._id }, {
      $set: { status: 'generated', generatedAt: new Date(), 'counts.generated': generated },
    });
    await audit.record({
      user, action: 'payroll.generate.complete', entity: 'payroll_run', entityId: key, details: { generated },
    });
  });

  return { started: true };
}

/* --------------------------------- send ---------------------------------- */

async function sendRun({
  runId, user, onlyFailed = false, ip,
}) {
  const batch = await findBatch(runId);
  if (!batch) throw httpError(404, 'Payroll run not found.');
  const key = String(batch._id);
  if (inFlight.has(key)) throw httpError(409, 'This run is already being processed.');
  assertEmailConfigured();

  await PayrollBatch.updateOne({ _id: batch._id }, { $set: { status: 'sending', sendStartedAt: new Date() } });
  await audit.record({
    user,
    action: onlyFailed ? 'payroll.retry_failed' : 'payroll.send.start',
    entity: 'payroll_run',
    entityId: key,
    ip,
    details: { period: batch.periodLabel },
  });

  runJob(key, async () => {
    // never resend already-sent; skipped rows are never sent
    const statuses = onlyFailed ? ['FAILED'] : ['PENDING', 'FAILED'];
    const targets = await EmailLog.find({ batch: batch._id, status: { $in: statuses } }, { _id: 1 }).sort({ _id: 1 }).lean();
    const retryDelays = env.EMAIL_RETRY_DELAYS_MS;
    let paused = null; // set when the sending ACCOUNT can't send (bad login, daily limit)

    // Controlled delivery: EMAIL_BATCH_SIZE emails per batch, at most
    // EMAIL_CONCURRENCY at a time, then pause EMAIL_BATCH_PAUSE_MS — never
    // hundreds of emails at once. One failure never stops the rest.
    const pass = async (ids, claimStatuses, finalAttempt) => {
      const size = env.EMAIL_BATCH_SIZE;
      const totalBatches = Math.ceil(ids.length / size);
      for (let i = 0; i < ids.length && !paused; i += size) {
        logger.info('email_batch_start', { runId: key, batch: i / size + 1, of: totalBatches, emails: Math.min(size, ids.length - i) });
        // eslint-disable-next-line no-await-in-loop
        await mapWithConcurrency(ids.slice(i, i + size), env.EMAIL_CONCURRENCY, async (t) => {
          if (paused) return;
          await sendOne(t._id, { statuses: claimStatuses, finalAttempt }).catch((e) => {
            if (e.kind === 'system') paused = paused || e;
            logger.warn('send_one_failed', { emailLog: String(t._id), kind: e.kind, error: e.message });
          });
        });
        // eslint-disable-next-line no-await-in-loop
        if (!paused && i + size < ids.length) await new Promise((r) => setTimeout(r, env.EMAIL_BATCH_PAUSE_MS));
      }
    };

    await pass(targets, statuses, retryDelays.length === 0);
    // Temporary problems ("try again later", network, PDF engine) are retried
    // automatically; only after the last round is an employee marked failed.
    for (let r = 0; r < retryDelays.length && !paused; r += 1) {
      // eslint-disable-next-line no-await-in-loop
      const again = await EmailLog.find({ batch: batch._id, status: 'PENDING', nextAttemptAt: { $ne: null } }, { _id: 1 }).sort({ _id: 1 }).lean();
      if (!again.length) break;
      logger.info('email_retry_round', { runId: key, round: r + 1, emails: again.length, waitMs: retryDelays[r] });
      // eslint-disable-next-line no-await-in-loop
      await new Promise((res) => setTimeout(res, retryDelays[r]));
      // eslint-disable-next-line no-await-in-loop
      await pass(again, ['PENDING'], r === retryDelays.length - 1);
    }
    if (paused) {
      await audit.record({
        user, action: 'payroll.send.paused', entity: 'payroll_run', entityId: key, details: { reason: String(paused.message).slice(0, 300) },
      });
    }

    const counts = await emailCounts(key);
    await PayrollBatch.updateOne({ _id: batch._id }, {
      $set: {
        status: 'completed',
        completedAt: new Date(),
        'counts.sent': counts.sent,
        'counts.failed': counts.failed,
        'counts.skipped': counts.skipped,
        'counts.pending': counts.pending + counts.generated,
      },
    });
    await audit.record({
      user, action: 'payroll.send.complete', entity: 'payroll_run', entityId: key, details: counts,
    });
  });

  return { started: true };
}

/**
 * Send exactly one payslip to exactly its own employee.
 * The EmailLog is claimed atomically (status → SENDING) first; if it is not
 * in one of `statuses` (e.g. already SENT or being sent), nothing happens.
 */
async function sendOne(emailLogId, { statuses = ['PENDING', 'FAILED'], finalAttempt = true } = {}) {
  const now = new Date();
  // returns the record as it was BEFORE the claim (to restore it if the
  // sending account itself can't send)
  const log = await EmailLog.findOneAndUpdate(
    { _id: emailLogId, status: { $in: statuses } },
    {
      $set: {
        status: 'SENDING', lockedAt: now, lockOwner: WORKER_ID, lastAttemptAt: now,
      },
      $inc: { attemptCount: 1 },
    },
    { returnDocument: 'before' },
  );
  if (!log) return null;

  try {
    const [p, batch] = await Promise.all([
      Payslip.findById(log.payslip).lean(),
      PayrollBatch.findById(log.batch, { periodLabel: 1 }).lean(),
    ]);
    // integrity checks: the payslip, recipient and batch must all match this log
    if (!p || !batch || !p.valid) throw Object.assign(new Error('Payslip is missing or not valid for sending.'), { kind: 'address' });
    if (String(p.batch) !== String(log.batch) || p.email !== log.email) {
      throw Object.assign(new Error('Payslip/recipient mismatch — not sent.'), { kind: 'address' });
    }
    if (!isValidEmail(p.email)) throw Object.assign(new Error('Invalid email address.'), { kind: 'address' });
    // mistyped domain (gmial.com, aun.edu.n, …) → fail now, with a clear reason
    const domain = await emailCheck.checkRecipientDomain(p.email);
    if (!domain.ok) throw Object.assign(new Error(`${domain.reason} Correct the email address, then send again.`), { kind: 'address' });

    const { buffer, filename, sha } = await renderPayslip(p, batch.periodLabel);
    const result = await email.sendPayAdvice({
      toEmail: p.email,
      employeeName: p.name,
      period: batch.periodLabel,
      pdfBuffer: buffer,
      pdfFilename: filename,
    });

    const sentAt = new Date();
    await Promise.all([
      EmailLog.updateOne({ _id: log._id }, {
        $set: {
          status: 'SENT',
          sentAt,
          provider: 'smtp',
          providerMessageId: result.messageId ? String(result.messageId).slice(0, 200) : undefined,
          deliveredTo: p.email,
        },
        $unset: {
          failureReason: 1, lockedAt: 1, lockOwner: 1, nextAttemptAt: 1,
        },
        $push: { attempts: { $each: [{ at: sentAt, outcome: 'sent', provider: 'smtp', messageId: result.messageId ? String(result.messageId).slice(0, 200) : undefined }], $slice: -20 } },
      }),
      Payslip.updateOne({ _id: p._id }, { $set: { generatedAt: p.generatedAt || sentAt, pdfSha256: sha } }),
    ]);
    return { status: 'SENT' };
  } catch (e) {
    const kind = emailCheck.classifySendError(e);
    const detail = String((e.response || e.message) || 'Unknown error').slice(0, 400);
    const attempt = { at: new Date(), outcome: 'failed', provider: 'smtp', error: detail.slice(0, 500) };
    const unlock = { lockedAt: 1, lockOwner: 1 };

    if (kind === 'system') {
      // The sending ACCOUNT can't send (wrong password, daily limit): nobody is
      // failed — this employee goes back to where it was and sending pauses.
      const set = { status: log.status };
      if (log.status !== 'SENT') set.failureReason = `Not sent yet — sending paused: ${detail}`.slice(0, 500);
      await EmailLog.updateOne({ _id: log._id }, {
        $set: set, $unset: { ...unlock, nextAttemptAt: 1 }, $inc: { attemptCount: -1 },
      });
    } else if (kind === 'temporary' && !finalAttempt) {
      // will be retried automatically by the running send job
      await EmailLog.updateOne({ _id: log._id }, {
        $set: { status: 'PENDING', failureReason: `Temporary problem — retrying automatically: ${detail}`.slice(0, 500), nextAttemptAt: new Date(Date.now() + 60000) },
        $unset: unlock,
        $push: { attempts: { $each: [attempt], $slice: -20 } },
      });
    } else {
      const reason = kind === 'address'
        ? `Email address problem: ${detail}`
        : `Not delivered after ${log.attemptCount + 1} attempt(s) (temporary problem): ${detail} — use Retry Failed later.`;
      await EmailLog.updateOne({ _id: log._id }, {
        $set: { status: 'FAILED', failureReason: reason.slice(0, 500) },
        $unset: { ...unlock, nextAttemptAt: 1 },
        $push: { attempts: { $each: [attempt], $slice: -20 } },
      });
    }
    throw Object.assign(e, { kind });
  }
}

async function resendEmployee({ employeeId, user, ip }) {
  if (!isValidObjectId(employeeId)) throw httpError(404, 'Employee not found.');
  const p = await Payslip.findById(employeeId, { valid: 1, employeeId: 1, batch: 1 }).lean();
  if (!p) throw httpError(404, 'Employee not found.');
  if (!p.valid) throw httpError(400, 'Cannot send — this record has validation errors.');
  const log = await EmailLog.findOne({ payslip: p._id }, { _id: 1, status: 1 }).lean();
  if (!log) throw httpError(404, 'No delivery record for this employee.');
  if (log.status === 'SENDING') throw httpError(409, 'This pay advice is already being sent.');
  assertEmailConfigured();

  // explicit single resend: may re-send an already-SENT payslip (audited)
  let res;
  // a temporary problem gets one quick automatic retry before reporting
  for (let attempt = 1; ; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      res = await sendOne(log._id, { statuses: ['PENDING', 'FAILED', 'SENT'], finalAttempt: attempt >= 2 });
      break;
    } catch (e) {
      if (e.kind === 'temporary' && attempt < 2) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 3000));
        continue; // eslint-disable-line no-continue
      }
      // the reason is recorded on the delivery record; show it to the admin too
      throw httpError(424, `The email could not be sent: ${String(e.message).slice(0, 200)}`);
    }
  }
  if (!res) throw httpError(409, 'This pay advice is already being sent.');
  await audit.record({
    user,
    action: 'payroll.resend_one',
    entity: 'employee',
    entityId: String(p._id),
    ip,
    details: { employeeId: p.employeeId, previousStatus: log.status },
  });
  return getEmployee(p._id);
}

/* --------------------- admin corrections: edit / delete ------------------- */

// Editable text fields → [path in the advice snapshot, label, max length]
const EDITABLE_TEXT = {
  name: [['employee', 'name'], 'Employee name', 200],
  employeeId: [['employee', 'employeeId'], 'Employee ID', 64],
  department: [['employee', 'department'], 'Department', 200],
  designation: [['employee', 'designation'], 'Designation', 200],
  bank: [['employee', 'bank'], 'Bank', 120],
  accountNo: [['employee', 'accountNo'], 'Account number', 40],
  tin: [['bankTax', 'tin'], 'TIN', 40],
  pfaName: [['pension', 'pfaName'], 'PFA name', 200],
  pensionPin: [['pension', 'pensionPin'], 'Pension PIN', 40],
  nhfNumber: [['pension', 'nhfNumber'], 'NHF number', 40],
};

const round2 = (n) => Math.round(n * 100) / 100;
/** Amount from the edit form: number or numeric string (commas allowed). */
function editAmount(v, label) {
  const n = typeof v === 'number' ? v : Number(String(v == null ? '' : v).replace(/[,\s₦]/g, ''));
  if (!Number.isFinite(n) || Math.abs(n) > 1e11) throw httpError(400, `${label}: enter a valid amount.`);
  return round2(n);
}

/** Block corrections while the run is being generated/sent or this email is in flight. */
async function assertEditable(p) {
  if (inFlight.has(String(p.batch))) {
    throw httpError(409, 'This payroll run is being processed right now. Wait for it to finish, then try again.');
  }
  const log = await EmailLog.findOne({ payslip: p._id }).lean();
  if (log && log.status === 'SENDING') throw httpError(409, 'This pay advice is being emailed right now. Try again in a moment.');
  return log;
}

/** Re-derive the run's validation summary and counts from its stored records. */
async function refreshBatchSummary(batchId) {
  const batch = await PayrollBatch.findById(batchId, { validationSummary: 1 }).lean();
  if (!batch) return;
  const rows = await Payslip.find({ batch: batchId }, { valid: 1, issues: 1 }).lean();
  const summary = excel.buildSummary(
    rows.map((r) => ({ valid: r.valid, issues: r.issues || [] })),
    (batch.validationSummary && batch.validationSummary.missingColumns) || [],
  );
  const counts = await emailCounts(batchId);
  await PayrollBatch.updateOne({ _id: batchId }, {
    $set: {
      validationSummary: summary,
      'counts.total': summary.total,
      'counts.valid': summary.valid,
      'counts.invalid': summary.invalid,
      'counts.generated': counts.generated,
      'counts.sent': counts.sent,
      'counts.failed': counts.failed,
      'counts.skipped': counts.skipped,
      'counts.pending': counts.pending,
    },
  });
}

/**
 * Admin correction of one employee's payroll record. The edited record is
 * re-validated with the SAME rules as an upload. Totals are recalculated from
 * the line items only when an amount changed. The PDF is re-rendered from the
 * corrected data on the next preview/send; an already-sent employee keeps the
 * "sent" status until the admin re-sends the corrected pay advice.
 */
async function updateEmployeeRecord({
  payslipId, changes, user, ip,
}) {
  if (!isValidObjectId(payslipId)) throw httpError(404, 'Employee not found.');
  const p = await Payslip.findById(payslipId).lean();
  if (!p) throw httpError(404, 'Employee not found.');
  const log = await assertEditable(p);
  const c = changes || {};

  const advice = JSON.parse(JSON.stringify(p.advice));
  const changed = [];
  Object.entries(EDITABLE_TEXT).forEach(([key, [[group, field], label, max]]) => {
    if (c[key] === undefined) return;
    const v = cleanText(c[key]);
    if (v.length > max) throw httpError(400, `${label} is too long (max ${max} characters).`);
    if (v !== (advice[group][field] || '')) { advice[group][field] = v; changed.push(key); }
  });
  let emailAddr = p.email;
  if (c.email !== undefined) {
    const v = cleanText(c.email).replace(/^mailto:/i, '').toLowerCase();
    if (v.length > 254) throw httpError(400, 'Email address is too long.');
    if (v !== p.email) { emailAddr = v; changed.push('email'); }
  }

  let amountsChanged = false;
  if (c.annualSalary !== undefined) {
    const v = editAmount(c.annualSalary, 'Annual salary');
    if (v !== advice.annualSalary) { advice.annualSalary = v; changed.push('annualSalary'); }
  }
  ['earnings', 'deductions'].forEach((kind) => {
    if (c[kind] === undefined) return;
    if (!Array.isArray(c[kind]) || c[kind].length !== advice[kind].length) {
      throw httpError(400, `The ${kind} list does not match this record. Reload the page and try again.`);
    }
    c[kind].forEach((v, i) => {
      const n = editAmount(v, advice[kind][i].label);
      if (n !== advice[kind][i].amount) { advice[kind][i].amount = n; amountsChanged = true; }
    });
    if (amountsChanged && !changed.includes(kind)) changed.push(kind);
  });
  if (!changed.length) return getEmployee(p._id);

  const earnSum = round2(advice.earnings.reduce((s, x) => s + x.amount, 0));
  const dedSum = round2(advice.deductions.reduce((s, x) => s + x.amount, 0));
  if (amountsChanged) {
    advice.totals = { grossEarnings: earnSum, grossDeductions: dedSum, netPay: round2(earnSum - dedSum) };
  }
  const t = advice.totals;
  const near = (a, b) => Math.abs((a || 0) - (b || 0)) <= 1.0;
  advice.reconciliation = {
    earningsSum: earnSum,
    deductionsSum: dedSum,
    earningsMatch: near(earnSum, t.grossEarnings),
    deductionsMatch: near(dedSum, t.grossDeductions),
    netMatch: near(t.grossEarnings - t.grossDeductions, t.netPay),
  };

  // same validation as an upload, plus duplicates against the rest of this run
  const issues = excel.validateRecord({ email: emailAddr, numericIssues: [], advice });
  const others = { batch: p.batch, _id: { $ne: p._id }, valid: true };
  const idRx = new RegExp(`^${escapeRegex(advice.employee.employeeId)}$`, 'i');
  if (advice.employee.employeeId && await Payslip.exists({ ...others, employeeId: idRx })) {
    issues.push('Duplicate employee ID (another record in this run)');
  }
  if (emailAddr && await Payslip.exists({ ...others, email: emailAddr })) {
    issues.push('Duplicate email (another record in this run)');
  }
  const valid = issues.filter((i) => !i.includes('(warning)')).length === 0;

  let employeeRef;
  if (valid) {
    const dir = await Employee.findOneAndUpdate(
      { employeeId: advice.employee.employeeId },
      {
        $set: {
          name: advice.employee.name,
          email: emailAddr,
          department: advice.employee.department,
          designation: advice.employee.designation,
          lastBatch: p.batch,
          lastSeenAt: new Date(),
        },
      },
      { upsert: true, returnDocument: 'after', projection: { _id: 1 } },
    );
    employeeRef = dir._id;
  }

  try {
    await Payslip.updateOne({ _id: p._id }, {
      $set: {
        ...(employeeRef ? { employee: employeeRef } : {}),
        employeeId: advice.employee.employeeId,
        name: advice.employee.name,
        email: emailAddr,
        department: advice.employee.department,
        designation: advice.employee.designation,
        grossPay: t.grossEarnings,
        totalDeductions: t.grossDeductions,
        netPay: t.netPay,
        advice,
        valid,
        issues: issues.slice(0, 50),
      },
      // the stored PDF fingerprint belongs to the old data
      $unset: { generatedAt: 1, pdfSha256: 1, ...(employeeRef ? {} : { employee: 1 }) },
    }, { runValidators: true });
  } catch (e) {
    if (e && e.code === 11000) throw httpError(409, 'Another valid record in this run already has that employee ID.');
    throw asBadRequest(e);
  }

  // keep the delivery record in step (its recipient must match the payslip)
  if (log) {
    const set = { email: emailAddr, employeeName: advice.employee.name, employeeId: advice.employee.employeeId };
    if (employeeRef) set.employee = employeeRef;
    const update = { $set: set };
    if (!valid && log.status !== 'SENT') {
      set.status = 'SKIPPED';
      set.failureReason = issues.filter((i) => !i.includes('(warning)')).join('; ').slice(0, 500);
    } else if (valid && log.status === 'SKIPPED') {
      set.status = 'PENDING';
      update.$unset = { failureReason: 1 };
    }
    await EmailLog.updateOne({ _id: log._id }, update);
  }
  await refreshBatchSummary(p.batch);

  await audit.record({
    user,
    action: 'payroll.record_edited',
    entity: 'employee',
    entityId: String(p._id),
    ip,
    // field NAMES only — never salaries or bank details in the audit log
    details: {
      employeeId: advice.employee.employeeId, changed, valid, alreadySent: !!(log && log.status === 'SENT'),
    },
  });
  return getEmployee(p._id);
}

/** Admin: remove one employee's record (and its delivery record) from a run. */
async function deleteEmployeeRecord({ payslipId, user, ip }) {
  if (!isValidObjectId(payslipId)) throw httpError(404, 'Employee not found.');
  const p = await Payslip.findById(payslipId, { batch: 1, employeeId: 1, name: 1 }).lean();
  if (!p) throw httpError(404, 'Employee not found.');
  const log = await assertEditable(p);

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await EmailLog.deleteMany({ payslip: p._id }, { session });
      await Payslip.deleteOne({ _id: p._id }, { session });
    });
  } finally {
    await session.endSession();
  }
  await refreshBatchSummary(p.batch);
  await audit.record({
    user,
    action: 'payroll.record_deleted',
    entity: 'employee',
    entityId: String(p._id),
    ip,
    details: { employeeId: p.employeeId, runId: String(p.batch), emailStatus: log ? log.status : null },
  });
  return { ok: true, runId: String(p.batch) };
}

/** Admin: delete a whole payroll run with all its records and delivery records. */
async function deleteRun({ runId, user, ip }) {
  const batch = await findBatch(runId);
  if (!batch) throw httpError(404, 'Payroll run not found.');
  const key = String(batch._id);
  if (inFlight.has(key)) throw httpError(409, 'This payroll run is being processed right now. Wait for it to finish, then try again.');
  if (await EmailLog.exists({ batch: batch._id, status: 'SENDING' })) {
    throw httpError(409, 'Pay advices from this run are being emailed right now. Try again in a moment.');
  }
  const counts = await emailCounts(key);

  const session = await mongoose.startSession();
  let removed = 0;
  try {
    await session.withTransaction(async () => {
      await EmailLog.deleteMany({ batch: batch._id }, { session });
      removed = (await Payslip.deleteMany({ batch: batch._id }, { session })).deletedCount;
      await PayrollBatch.deleteOne({ _id: batch._id }, { session });
    });
  } finally {
    await session.endSession();
  }
  await audit.record({
    user,
    action: 'payroll.run_deleted',
    entity: 'payroll_run',
    entityId: key,
    ip,
    details: {
      period: batch.periodLabel, filename: batch.originalFilename, records: removed, alreadySent: counts.sent,
    },
  });
  return { ok: true };
}

/* -------------------------------- helpers -------------------------------- */

/** Refuse to start sending when SMTP is not configured (instead of failing every row). */
function assertEmailConfigured() {
  if (!(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD && env.SMTP_FROM)) {
    throw httpError(409, 'Email is not configured on the server yet (SMTP settings in backend/.env). Nothing was sent.');
  }
}

/**
 * Boot-time recovery after a crash/restart (jobs run in-process, so any job
 * that was running is gone):
 *  - SENDING emails → FAILED "interrupted". Not re-sent automatically: SMTP
 *    has no idempotency, so the email may already have been delivered. The
 *    admin checks and uses "Retry Failed".
 *  - batches stuck in generating/sending → a resumable state.
 */
async function recoverInterruptedJobs() {
  const now = new Date();
  const reason = 'Interrupted by a server restart while sending — it may or may not have been delivered. Check with the employee before retrying.';
  const stuck = await EmailLog.updateMany({ status: 'SENDING' }, {
    $set: { status: 'FAILED', failureReason: reason },
    $unset: { lockedAt: 1, lockOwner: 1 },
    $push: { attempts: { $each: [{ at: now, outcome: 'failed', provider: 'smtp', error: 'interrupted' }], $slice: -20 } },
  });
  const gen = await PayrollBatch.updateMany({ status: 'generating' }, { $set: { status: 'validated' } });
  const snd = await PayrollBatch.updateMany({ status: 'sending' }, { $set: { status: 'completed', completedAt: now } });
  if (stuck.modifiedCount || gen.modifiedCount || snd.modifiedCount) {
    logger.warn('recovered_interrupted_jobs', { emails: stuck.modifiedCount, generating: gen.modifiedCount, sending: snd.modifiedCount });
  }
}

async function runProgress(batchId) {
  const counts = await emailCounts(batchId);
  const run = await getRun(batchId);
  return { run, counts };
}

function runJob(key, fn) {
  inFlight.add(key);
  Promise.resolve()
    .then(fn)
    .catch((e) => logger.error('job_failed', { runId: key, error: e.message }))
    .finally(() => inFlight.delete(key));
}

async function mapWithConcurrency(items, limit, worker) {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      // eslint-disable-next-line no-await-in-loop
      await worker(item);
    }
  });
  await Promise.all(runners);
}

module.exports = {
  createRunFromUpload,
  recoverInterruptedJobs,
  getRun,
  listRuns,
  getRunEmployees,
  getEmployee,
  renderPayslip,
  generateRun,
  sendRun,
  sendOne,
  resendEmployee,
  updateEmployeeRecord,
  deleteEmployeeRecord,
  deleteRun,
  runProgress,
  emailCounts,
  batchTotals,
  findBatch,
};
