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
const logger = require('../utils/logger');
const { safeFilePart, isValidEmail, MONTHS } = require('../utils/validators');

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

    // Controlled delivery: EMAIL_BATCH_SIZE emails per batch, at most
    // EMAIL_CONCURRENCY at a time, then pause EMAIL_BATCH_PAUSE_MS — never
    // hundreds of emails at once. One failure never stops the rest.
    const size = env.EMAIL_BATCH_SIZE;
    const totalBatches = Math.ceil(targets.length / size);
    for (let i = 0; i < targets.length; i += size) {
      const n = i / size + 1;
      logger.info('email_batch_start', { runId: key, batch: n, of: totalBatches, emails: Math.min(size, targets.length - i) });
      // eslint-disable-next-line no-await-in-loop
      await mapWithConcurrency(targets.slice(i, i + size), env.EMAIL_CONCURRENCY, async (t) => {
        await sendOne(t._id, { statuses }).catch((e) => logger.error('send_one_failed', { emailLog: String(t._id), error: e.message }));
      });
      // eslint-disable-next-line no-await-in-loop
      if (i + size < targets.length) await new Promise((r) => setTimeout(r, env.EMAIL_BATCH_PAUSE_MS));
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
async function sendOne(emailLogId, { statuses = ['PENDING', 'FAILED'] } = {}) {
  const now = new Date();
  const log = await EmailLog.findOneAndUpdate(
    { _id: emailLogId, status: { $in: statuses } },
    {
      $set: {
        status: 'SENDING', lockedAt: now, lockOwner: WORKER_ID, lastAttemptAt: now,
      },
      $inc: { attemptCount: 1 },
    },
    { returnDocument: 'after' },
  );
  if (!log) return null;

  try {
    const [p, batch] = await Promise.all([
      Payslip.findById(log.payslip).lean(),
      PayrollBatch.findById(log.batch, { periodLabel: 1 }).lean(),
    ]);
    // integrity checks: the payslip, recipient and batch must all match this log
    if (!p || !batch || !p.valid) throw new Error('Payslip is missing or not valid for sending.');
    if (String(p.batch) !== String(log.batch) || p.email !== log.email) {
      throw new Error('Payslip/recipient mismatch — not sent.');
    }
    if (!isValidEmail(p.email)) throw new Error('Invalid email address.');

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
        $unset: { failureReason: 1, lockedAt: 1, lockOwner: 1 },
        $push: { attempts: { $each: [{ at: sentAt, outcome: 'sent', provider: 'smtp', messageId: result.messageId ? String(result.messageId).slice(0, 200) : undefined }], $slice: -20 } },
      }),
      Payslip.updateOne({ _id: p._id }, { $set: { generatedAt: p.generatedAt || sentAt, pdfSha256: sha } }),
    ]);
    return { status: 'SENT' };
  } catch (e) {
    const reason = String(e.message || 'Unknown error').slice(0, 500);
    await EmailLog.updateOne({ _id: log._id }, {
      $set: { status: 'FAILED', failureReason: reason },
      $unset: { lockedAt: 1, lockOwner: 1 },
      $push: { attempts: { $each: [{ at: new Date(), outcome: 'failed', provider: 'smtp', error: reason }], $slice: -20 } },
    });
    throw e;
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
  try {
    res = await sendOne(log._id, { statuses: ['PENDING', 'FAILED', 'SENT'] });
  } catch (e) {
    // the reason is recorded on the delivery record; show it to the admin too
    throw httpError(424, `The email could not be sent: ${String(e.message).slice(0, 200)}`);
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
  runProgress,
  emailCounts,
  batchTotals,
  findBatch,
};
