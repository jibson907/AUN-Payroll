const { EmailLog } = require('../models');
const payroll = require('../services/payrollService');
const audit = require('../services/auditService');

async function summary(req, res) {
  const runs = await payroll.listRuns(); // newest first, live counts
  const latest = runs[0] || null;

  const agg = {
    totalRuns: runs.length,
    totalEmployees: runs.reduce((s, r) => s + (r.total_employees || 0), 0),
    generated: runs.reduce((s, r) => s + (r.generated_count || 0), 0),
    sent: runs.reduce((s, r) => s + (r.sent_count || 0), 0),
    failed: runs.reduce((s, r) => s + (r.failed_count || 0), 0),
    skipped: runs.reduce((s, r) => s + (r.skipped_count || 0), 0),
  };
  // pending = valid, not yet sent and not failed, across all runs
  agg.pending = await EmailLog.countDocuments({ status: { $in: ['PENDING', 'SENDING'] } });

  const recentRuns = runs.slice(0, 5).map((r) => ({
    id: r.id,
    period: r.period,
    total_employees: r.total_employees,
    generated_count: r.generated_count,
    sent_count: r.sent_count,
    failed_count: r.failed_count,
    status: r.status,
    created_at: r.created_at,
  }));

  const recentActivity = await audit.list({ limit: 8 });

  return res.json({
    agg, latest, recentRuns, recentActivity,
  });
}

async function auditLog(req, res) {
  const limit = Math.min(500, Math.max(1, Math.floor(Number(req.query.limit)) || 100));
  const offset = Math.max(0, Math.floor(Number(req.query.offset)) || 0);
  return res.json({ logs: await audit.list({ limit, offset }) });
}

module.exports = { summary, auditLog };
