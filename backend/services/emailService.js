/**
 * emailService.js — send one pay advice to one employee via SMTP (Nodemailer).
 *
 * One email == one employee's own PDF, addressed only to that employee.
 * Credentials come ONLY from backend/.env (never the database or browser).
 * If SMTP is not configured, sending FAILS with a clear reason — it never
 * pretends to send, so no payslip is ever marked "sent" by mistake.
 *
 * Email layout follows the AUN Payroll sample:
 *   Subject:  Payroll: Pay Advice Slip for the month of June 2026
 *   Body:     "Dear <Employee Name>, Your pay advice for the pay period of …"
 *   Attach:   "<Employee Name> Pay Advice for June 2026.pdf"
 */
const nodemailer = require('nodemailer');
const settings = require('./settingsService');
const logger = require('../utils/logger');
const env = require('../config/env');
const { isValidEmail, cleanText } = require('../utils/validators');

let cachedKey = '';
let cachedTransport = null;

const notConfigured = () => Object.assign(
  new Error('Email is not configured on the server (SMTP settings in backend/.env). Nothing was sent.'),
  { code: 'EMAIL_NOT_CONFIGURED' },
);

async function getTransport() {
  const cfg = await settings.getSmtpConfig();
  if (!cfg.host || !cfg.user || !cfg.password || !cfg.from) throw notConfigured();
  const key = JSON.stringify({ h: cfg.host, p: cfg.port, s: cfg.secure, u: cfg.user });
  if (cachedTransport && cachedKey === key) return { transport: cachedTransport, cfg };
  cachedTransport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    requireTLS: !cfg.secure, // STARTTLS is mandatory on 587 — never send in clear text
    auth: { user: cfg.user, pass: cfg.password },
    pool: true,
    maxConnections: 2,
    connectionTimeout: 20000,
    greetingTimeout: 20000,
    socketTimeout: 60000,
    tls: { minVersion: 'TLSv1.2' },
  });
  cachedKey = key;
  return { transport: cachedTransport, cfg };
}

function resetTransport() {
  if (cachedTransport) cachedTransport.close();
  cachedTransport = null;
  cachedKey = '';
}

async function verifyConnection() {
  try {
    const { transport } = await getTransport();
    await transport.verify();
    return { ok: true, message: 'SMTP connection successful.' };
  } catch (e) {
    if (e.code === 'EMAIL_NOT_CONFIGURED') return { ok: false, message: e.message };
    return { ok: false, message: `SMTP connection failed: ${String(e.response || e.message).slice(0, 200)}` };
  }
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function subjectFor(period) {
  return `Payroll: Pay Advice Slip for the month of ${cleanText(period)}`;
}

/** Plain-text + HTML body matching the AUN Payroll sample. */
function buildBody(name, period) {
  const who = cleanText(name) || 'Employee';
  const p = cleanText(period);
  const year = new Date().getFullYear();
  const text = [
    'American University of Nigeria',
    '',
    `Dear ${who},`,
    '',
    `Your pay advice for the pay period of ${p} is attached to this email.`,
    '',
    'Please review the attached PDF document for a detailed breakdown of your earnings. If you have any questions, please contact the Payroll department.',
    '',
    'Thank you,',
    'The Payroll Team',
    '',
    'This is an automated message from the Payroll Automation System. Please do not reply.',
    '',
    `© ${year} American University of Nigeria. All Rights Reserved.`,
    '',
    'This email and any attachments are confidential and intended solely for the use of the individual to whom it is addressed.',
  ].join('\n');
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;line-height:1.5">
<p>American University of Nigeria</p>
<p>Dear ${esc(who)},</p>
<p>Your pay advice for the pay period of ${esc(p)} is attached to this email.</p>
<p>Please review the attached PDF document for a detailed breakdown of your earnings. If you have any questions, please contact the Payroll department.</p>
<p>Thank you,<br/>The Payroll Team</p>
<p>This is an automated message from the Payroll Automation System. Please do not reply.</p>
<p>&copy; ${year} American University of Nigeria. All Rights Reserved.</p>
<p>This email and any attachments are confidential and intended solely for the use of the individual to whom it is addressed.</p>
</div>`;
  return { text, html };
}

/**
 * Send one pay advice to one employee.
 * @param {object} p { toEmail, employeeName, period, pdfBuffer, pdfFilename }
 * @returns { messageId, accepted }
 */
async function sendPayAdvice({
  toEmail, employeeName, period, pdfBuffer, pdfFilename,
}) {
  // Re-validated here as well: a single plain mailbox, never a list or display name.
  if (!isValidEmail(toEmail)) throw new Error('Invalid recipient email address.');
  const { transport, cfg } = await getTransport();
  const body = buildBody(employeeName, period);

  const info = await transport.sendMail({
    from: cfg.from,
    to: toEmail,
    replyTo: env.EMAIL_REPLY_TO || undefined,
    subject: subjectFor(period),
    text: body.text,
    html: body.html,
    attachments: [{ filename: pdfFilename, content: pdfBuffer, contentType: 'application/pdf' }],
  });

  // the provider must have accepted exactly this one recipient
  const accepted = (info.accepted || []).map((a) => String(a.address || a).toLowerCase());
  if (!accepted.includes(toEmail.toLowerCase())) {
    throw new Error(`The mail server did not accept the recipient (${String(info.response || 'rejected').slice(0, 120)}).`);
  }
  logger.info('email_sent', { to: toEmail, messageId: info.messageId });
  return { messageId: info.messageId, accepted };
}

module.exports = {
  sendPayAdvice, verifyConnection, getTransport, resetTransport, buildBody, subjectFor,
};
