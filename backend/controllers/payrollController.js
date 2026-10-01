const payroll = require('../services/payrollService');
const pdf = require('../services/pdfService');
const audit = require('../services/auditService');
const { isValidPeriod } = require('../utils/validators');

// Query/body values must be plain strings before they reach a query
// (?status[$ne]=x arrives as an object and is ignored).
const asString = (v) => (typeof v === 'string' ? v.trim() : '');

async function upload(req, res) {
  if (!req.file) return res.status(400).json({ error: 'Please attach an Excel (.xlsx) file.' });
  const period = asString(req.body.period);
  if (!isValidPeriod(period)) {
    return res.status(400).json({ error: 'Please select a valid payroll period, e.g. "June 2026".' });
  }
  const result = await payroll.createRunFromUpload({
    user: req.user,
    buffer: req.file.buffer,
    filename: req.file.originalname,
    period,
    ip: req.ip,
  });
  return res.status(201).json(result);
}

async function listRuns(req, res) {
  return res.json({ runs: await payroll.listRuns() });
}

async function getRun(req, res) {
  const run = await payroll.getRun(req.params.id);
  if (!run) return res.status(404).json({ error: 'Payroll run not found.' });
  const counts = await payroll.emailCounts(req.params.id);
  return res.json({ run, counts });
}

async function getRunEmployees(req, res) {
  const { page, pageSize } = req.query;
  const data = await payroll.getRunEmployees(req.params.id, {
    search: asString(req.query.search),
    status: asString(req.query.status),
    page: Math.max(1, Math.floor(Number(page)) || 1),
    pageSize: Math.min(200, Math.max(1, Math.floor(Number(pageSize)) || 25)),
  });
  return res.json(data);
}

async function progress(req, res) {
  return res.json(await payroll.runProgress(req.params.id));
}

async function generate(req, res) {
  const out = await payroll.generateRun({ runId: req.params.id, user: req.user, ip: req.ip });
  return res.status(202).json(out);
}

async function send(req, res) {
  const out = await payroll.sendRun({
    runId: req.params.id, user: req.user, onlyFailed: false, ip: req.ip,
  });
  return res.status(202).json(out);
}

async function retryFailed(req, res) {
  const out = await payroll.sendRun({
    runId: req.params.id, user: req.user, onlyFailed: true, ip: req.ip,
  });
  return res.status(202).json(out);
}

// Employee-level actions (":empId" is the payslip id)
async function getEmployee(req, res) {
  const emp = await payroll.getEmployee(req.params.empId);
  if (!emp) return res.status(404).json({ error: 'Employee not found.' });
  return res.json({ employee: emp });
}

// Stream a single employee's PDF (auth-protected; rendered in memory, never stored)
async function employeePdf(req, res) {
  const emp = await payroll.getEmployee(req.params.empId);
  if (!emp) return res.status(404).json({ error: 'Employee not found.' });
  if (!emp.advice) return res.status(400).json({ error: 'No pay-advice data for this employee.' });
  const run = await payroll.findBatch(emp.run_id);
  const { buffer, filename } = await payroll.renderPayslip(emp, run.periodLabel);
  await audit.record({
    user: req.user, action: 'payroll.download_advice', entity: 'employee', entityId: emp.id, ip: req.ip, details: { employeeId: emp.employee_id },
  });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${pdf.asciiFilename(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.setHeader('Cache-Control', 'no-store');
  return res.send(buffer);
}

async function resendEmployee(req, res) {
  const emp = await payroll.resendEmployee({ employeeId: req.params.empId, user: req.user, ip: req.ip });
  return res.json({
    employee: {
      id: emp.id, email_status: emp.email_status, email_error: emp.email_error, sent_at: emp.sent_at,
    },
  });
}

module.exports = {
  upload,
  listRuns,
  getRun,
  getRunEmployees,
  progress,
  generate,
  send,
  retryFailed,
  getEmployee,
  employeePdf,
  resendEmployee,
};
