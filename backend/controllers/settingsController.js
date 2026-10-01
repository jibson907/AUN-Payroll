const settings = require('../services/settingsService');
const email = require('../services/emailService');
const audit = require('../services/auditService');

async function get(req, res) {
  return res.json(await settings.getPublicSettings());
}

async function updateSmtp(req, res) {
  // always rejected (403): credentials are server-side only
  await settings.updateSmtp(req.body || {});
  return res.json(await settings.getPublicSettings());
}

async function verifySmtp(req, res) {
  const result = await email.verifyConnection();
  await audit.record({ user: req.user, action: 'settings.smtp_verified', ip: req.ip, details: { ok: result.ok } });
  return res.json(result);
}

module.exports = { get, updateSmtp, verifySmtp };
