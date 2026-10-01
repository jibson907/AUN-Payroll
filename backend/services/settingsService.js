/**
 * settingsService.js — server settings exposed (read-only) to the admin.
 *
 * Email/SMTP credentials come ONLY from backend/.env. They are never stored
 * in the database and never returned to the client.
 */
const env = require('../config/env');

/** Effective SMTP config — environment only. */
async function getSmtpConfig() {
  return {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    user: env.SMTP_USER,
    password: env.SMTP_PASSWORD,
    from: env.SMTP_FROM,
  };
}

/** Client-safe view (no secrets). */
async function getPublicSettings() {
  const smtp = await getSmtpConfig();
  return {
    smtp: {
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      user: smtp.user,
      from: smtp.from,
      replyTo: env.EMAIL_REPLY_TO || '',
      passwordConfigured: !!smtp.password,
      configured: !!(smtp.host && smtp.user && smtp.password && smtp.from),
      managedByServer: true,
    },
  };
}

async function updateSmtp() {
  throw Object.assign(
    new Error('Email credentials are configured on the server (backend/.env) and cannot be changed from the browser.'),
    { status: 403 },
  );
}

module.exports = { getSmtpConfig, getPublicSettings, updateSmtp };
