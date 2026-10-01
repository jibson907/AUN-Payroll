const bcrypt = require('bcryptjs');
const env = require('../config/env');
const { User } = require('../models');
const { issueSession, clearSession } = require('../middleware/auth');
const audit = require('../services/auditService');
const logger = require('../utils/logger');
const { isValidEmail, isBlank } = require('../utils/validators');
const { validatePassword } = require('../utils/password');

// Only plain strings reach queries (blocks {"email": {"$ne": ""}}-style input).
const asString = (v) => (typeof v === 'string' ? v : '');

// One message for EVERY failed sign-in (wrong email, wrong password, locked
// account) so responses never reveal which accounts exist or are locked.
const LOGIN_FAILED = `Invalid email or password. After ${env.LOGIN_MAX_FAILURES} failed attempts, sign-in is paused for ${env.LOGIN_LOCK_MINUTES} minutes.`;

// Compared against when the email is unknown, so response time does not
// reveal whether an account exists.
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser-not-a-real-password', env.BCRYPT_ROUNDS);

const publicUser = (u) => ({
  id: u.id, name: u.name, email: u.email, role: u.role,
});

async function login(req, res) {
  const email = asString((req.body || {}).email).trim().toLowerCase();
  const password = asString((req.body || {}).password);
  if (isBlank(email) || isBlank(password) || email.length > 254 || password.length > 1024) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }
  const now = new Date();
  const user = await User.findOne({ email, active: true }).select('+passwordHash');

  if (user && user.lockUntil && user.lockUntil > now) {
    await bcrypt.compare(password, DUMMY_HASH); // same timing as a normal attempt
    await audit.record({ user, action: 'auth.login_locked', ip: req.ip });
    return res.status(401).json({ error: LOGIN_FAILED });
  }

  const ok = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);
  if (!user || !ok) {
    let locked = false;
    if (user) {
      const failures = (user.failedLoginCount || 0) + 1;
      locked = failures >= env.LOGIN_MAX_FAILURES;
      await User.updateOne({ _id: user._id }, locked
        ? { $set: { failedLoginCount: 0, lockUntil: new Date(now.getTime() + env.LOGIN_LOCK_MINUTES * 60000) } }
        : { $set: { failedLoginCount: failures } });
      if (locked) logger.warn('account_locked', { email, ip: req.ip, minutes: env.LOGIN_LOCK_MINUTES });
    }
    await audit.record({
      user: user || null, action: locked ? 'auth.account_locked' : 'auth.login_failed', ip: req.ip, details: { email: email.slice(0, 254) },
    });
    return res.status(401).json({ error: LOGIN_FAILED });
  }

  await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: now, failedLoginCount: 0 }, $unset: { lockUntil: 1 } });
  await audit.record({ user, action: 'auth.login', ip: req.ip });
  const csrfToken = issueSession(res, user);
  return res.json({ user: publicUser(user), csrfToken });
}

async function me(req, res) {
  return res.json({ user: req.user, csrfToken: req.session.csrfToken });
}

/** Server-side logout: revokes every session of this user (all devices). */
async function logout(req, res) {
  await User.updateOne({ _id: req.user.id }, { $inc: { tokenVersion: 1 } });
  clearSession(res);
  await audit.record({ user: req.user, action: 'auth.logout', ip: req.ip });
  return res.json({ ok: true });
}

async function changePassword(req, res) {
  const currentPassword = asString((req.body || {}).currentPassword);
  const newPassword = asString((req.body || {}).newPassword);
  const weak = validatePassword(newPassword, { email: req.user.email });
  if (weak) return res.status(400).json({ error: weak });
  if (newPassword === currentPassword) {
    return res.status(400).json({ error: 'New password must be different from the current password.' });
  }
  const user = await User.findById(req.user.id).select('+passwordHash');
  const ok = user && (await bcrypt.compare(currentPassword, user.passwordHash));
  if (!ok) {
    await audit.record({ user: req.user, action: 'auth.password_change_failed', ip: req.ip });
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }
  const passwordHash = await bcrypt.hash(newPassword, env.BCRYPT_ROUNDS);
  // bump tokenVersion: every other session (other devices) is signed out …
  const updated = await User.findOneAndUpdate(
    { _id: user._id },
    { $set: { passwordHash, passwordChangedAt: new Date() }, $inc: { tokenVersion: 1 } },
    { returnDocument: 'after' },
  );
  await audit.record({ user: req.user, action: 'auth.password_changed', ip: req.ip });
  // … while this browser gets a fresh session and CSRF token
  const csrfToken = issueSession(res, updated);
  return res.json({ ok: true, csrfToken });
}

// admin-only: create additional payroll users (admins, officers, viewers)
async function createUser(req, res) {
  const name = asString((req.body || {}).name).trim();
  const email = asString((req.body || {}).email).trim().toLowerCase();
  const password = asString((req.body || {}).password);
  const role = asString((req.body || {}).role) || 'payroll_officer';
  if (isBlank(name) || name.length > 120 || !isValidEmail(email) || isBlank(password)) {
    return res.status(400).json({ error: 'Valid name, email and password are required.' });
  }
  if (!User.ROLES.includes(role)) {
    return res.status(400).json({ error: 'Role must be Administrator, Payroll Officer or Viewer.' });
  }
  const weak = validatePassword(password, { email });
  if (weak) return res.status(400).json({ error: weak });
  if (await User.exists({ email })) return res.status(409).json({ error: 'A user with that email already exists.' });
  const passwordHash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);
  const created = await User.create({
    name, email, passwordHash, role, passwordChangedAt: new Date(),
  });
  await audit.record({ user: req.user, action: 'user.created', entity: 'user', entityId: created.id, ip: req.ip, details: { email, role: created.role } });
  return res.status(201).json({ ok: true });
}

async function listUsers(req, res) {
  const users = await User.find().sort({ createdAt: 1 });
  return res.json({
    users: users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      active: u.active,
      created_at: u.createdAt,
      last_login_at: u.lastLoginAt || null,
    })),
  });
}

module.exports = {
  login, me, logout, changePassword, createUser, listUsers,
};
