const express = require('express');
const rateLimit = require('express-rate-limit');
const env = require('../config/env');
const logger = require('../utils/logger');
const { requireAuth, requireRole } = require('../middleware/auth');
const { uploadSingle } = require('../middleware/upload');
const authC = require('../controllers/authController');
const payC = require('../controllers/payrollController');
const dashC = require('../controllers/dashboardController');
const setC = require('../controllers/settingsController');

const db = require('../models/db');

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// health — actually pings MongoDB
router.get('/health', async (req, res) => {
  const connected = await db.checkConnection();
  res.status(connected ? 200 : 503).json({
    status: connected ? 'ok' : 'error',
    database: connected ? 'connected' : 'disconnected',
    time: new Date().toISOString(),
  });
});

// auth — brute-force protection on sign-in:
//  * per email+IP: LOGIN_MAX_FAILURES failed attempts per lock window
//  * per IP: 30 attempts per 15 min (spraying many emails from one address)
// Limited responses use the same wording as a wrong password (no enumeration);
// per-account lockout in the controller covers distributed attacks.
const limited = (name) => (req, res, next, options) => {
  logger.warn('rate_limited', { limiter: name, path: req.path, ip: req.ip });
  res.status(options.statusCode).json({ error: `Invalid email or password. After ${env.LOGIN_MAX_FAILURES} failed attempts, sign-in is paused for ${env.LOGIN_LOCK_MINUTES} minutes.` });
};
const loginPerAccount = rateLimit({
  windowMs: env.LOGIN_LOCK_MINUTES * 60 * 1000,
  limit: env.LOGIN_MAX_FAILURES,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.ip}|${typeof (req.body || {}).email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 254) : ''}`,
  handler: limited('login_per_account'),
});
const loginPerIp = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, handler: limited('login_per_ip'),
});

router.post('/auth/login', loginPerIp, loginPerAccount, wrap(authC.login));
router.get('/auth/me', requireAuth, wrap(authC.me));
router.post('/auth/logout', requireAuth, wrap(authC.logout));
router.post('/auth/change-password', requireAuth, wrap(authC.changePassword));
router.get('/users', requireAuth, requireRole('admin'), wrap(authC.listUsers));
router.post('/users', requireAuth, requireRole('admin'), wrap(authC.createUser));

// dashboard
router.get('/dashboard', requireAuth, wrap(dashC.summary));
router.get('/audit', requireAuth, wrap(dashC.auditLog));

// settings
router.get('/settings', requireAuth, wrap(setC.get));
router.put('/settings/smtp', requireAuth, requireRole('admin'), wrap(setC.updateSmtp));
router.post('/settings/smtp/verify', requireAuth, requireRole('admin'), wrap(setC.verifySmtp));

// payroll runs
const canProcess = requireRole('admin', 'payroll_officer');
// Per-user limits on expensive / sensitive actions (a stolen session or a
// stuck button must not be able to flood uploads, PDF renders or emails).
const perUser = (name, limit, message) => rateLimit({
  windowMs: 15 * 60 * 1000,
  limit,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${name}:${req.user.id}`,
  handler: (req, res, next, options) => {
    logger.warn('rate_limited', { limiter: name, user: req.user.email, ip: req.ip });
    res.status(options.statusCode).json({ error: message });
  },
});
const uploadLimit = perUser('upload', env.UPLOAD_LIMIT_PER_15MIN, 'Too many uploads. Please wait a few minutes and try again.');
const jobLimit = perUser('job', 30, 'Too many generate/send requests. Please wait a few minutes and try again.');
const resendLimit = perUser('resend', 60, 'Too many individual sends. Please wait a few minutes and try again.');
const pdfLimit = perUser('pdf', 300, 'Too many PDF requests. Please wait a few minutes and try again.');

router.post('/payroll/upload', requireAuth, canProcess, uploadLimit, uploadSingle, wrap(payC.upload));
router.get('/payroll/runs', requireAuth, wrap(payC.listRuns));
router.get('/payroll/runs/:id', requireAuth, wrap(payC.getRun));
router.get('/payroll/runs/:id/employees', requireAuth, wrap(payC.getRunEmployees));
router.get('/payroll/runs/:id/progress', requireAuth, wrap(payC.progress));
router.post('/payroll/runs/:id/generate', requireAuth, canProcess, jobLimit, wrap(payC.generate));
router.post('/payroll/runs/:id/send', requireAuth, canProcess, jobLimit, wrap(payC.send));
router.post('/payroll/runs/:id/retry-failed', requireAuth, canProcess, jobLimit, wrap(payC.retryFailed));

// employee-level (":empId" is the payslip id)
router.get('/payroll/employees/:empId', requireAuth, wrap(payC.getEmployee));
router.get('/payroll/employees/:empId/pdf', requireAuth, pdfLimit, wrap(payC.employeePdf));
router.post('/payroll/employees/:empId/resend', requireAuth, canProcess, resendLimit, wrap(payC.resendEmployee));

module.exports = router;
