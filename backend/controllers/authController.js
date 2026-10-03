const bcrypt = require('bcryptjs');
const env = require('../config/env');
const { User } = require('../models');
const { issueSession, clearSession } = require('../middleware/auth');
const audit = require('../services/auditService');
const logger = require('../utils/logger');
const { isValidEmail, isBlank } = require('../utils/validators');
const { validatePassword } = require('../utils/password');
const { permissionsFor } = require('../config/permissions');
const { isValidObjectId } = require('mongoose');

// Only plain strings reach queries (blocks {"email": {"$ne": ""}}-style input).
const asString = (v) => (typeof v === 'string' ? v : '');

// One message for EVERY failed sign-in (wrong email, wrong password, locked
// account) so responses never reveal which accounts exist or are locked.
const LOGIN_FAILED = `Invalid email or password. After ${env.LOGIN_MAX_FAILURES} failed attempts, sign-in is paused for ${env.LOGIN_LOCK_MINUTES} minutes.`;

// Compared against when the email is unknown, so response time does not
// reveal whether an account exists.
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser-not-a-real-password', env.BCRYPT_ROUNDS);

// `permissions` lets the UI hide what the API would refuse (config/permissions.js).
const publicUser = (u) => ({
  id: u.id, name: u.name, email: u.email, role: u.role, permissions: permissionsFor(u.role),
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
  return res.json({ user: publicUser(user), csrfToken, sessionIdleMinutes: env.SESSION_IDLE_MINUTES });
}

async function me(req, res) {
  return res.json({ user: publicUser(req.user), csrfToken: req.session.csrfToken, sessionIdleMinutes: env.SESSION_IDLE_MINUTES });
}

/**
 * Server-side logout: revokes every session of this user (all devices).
 * Automatic sign-out after inactivity ({ reason: "idle" }) ends only THIS
 * browser's session, so the user's other devices stay signed in.
 */
async function logout(req, res) {
  const idle = (req.body || {}).reason === 'idle';
  if (!idle) await User.updateOne({ _id: req.user.id }, { $inc: { tokenVersion: 1 } });
  clearSession(res);
  await audit.record({ user: req.user, action: idle ? 'auth.logout_idle' : 'auth.logout', ip: req.ip });
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

/* ---------------------- admin-only: manage other users --------------------- */

const ROLE_LABEL = { admin: 'Administrator', payroll_officer: 'Payroll Officer', viewer: 'Viewer' };

/** Load the target account for an admin action; refuses the admin's own account. */
async function targetUser(req, res, { allowSelf = false } = {}) {
  const { id } = req.params;
  if (!isValidObjectId(id)) { res.status(404).json({ error: 'User not found.' }); return null; }
  if (!allowSelf && id === req.user.id) {
    res.status(400).json({ error: 'You cannot do this to your own account. Use Change Password, or ask another administrator.' });
    return null;
  }
  const user = await User.findById(id);
  if (!user) { res.status(404).json({ error: 'User not found.' }); return null; }
  return user;
}

/** True if removing `user`'s admin rights would leave no active administrator. */
async function isLastActiveAdmin(user) {
  if (user.role !== 'admin' || !user.active) return false;
  return !(await User.exists({ _id: { $ne: user._id }, role: 'admin', active: true }));
}

// Edit name / email / role / active. Changing role or access signs the user
// out everywhere, so their next sign-in carries the new permissions.
async function updateUser(req, res) {
  const user = await targetUser(req, res, { allowSelf: true });
  if (!user) return null;
  const body = req.body || {};
  const self = String(user._id) === req.user.id;
  const set = {};

  if (body.name !== undefined) {
    const name = asString(body.name).trim();
    if (isBlank(name) || name.length > 120) return res.status(400).json({ error: 'A name (max 120 characters) is required.' });
    set.name = name;
  }
  if (body.email !== undefined) {
    const email = asString(body.email).trim().toLowerCase();
    if (!isValidEmail(email)) return res.status(400).json({ error: 'That is not a valid email address.' });
    if (email !== user.email && await User.exists({ email })) return res.status(409).json({ error: 'A user with that email already exists.' });
    set.email = email;
  }
  if (body.role !== undefined) {
    const role = asString(body.role);
    if (!User.ROLES.includes(role)) return res.status(400).json({ error: 'Role must be Administrator, Payroll Officer or Viewer.' });
    if (role !== user.role) {
      if (self) return res.status(400).json({ error: 'You cannot change your own role. Ask another administrator.' });
      if (await isLastActiveAdmin(user)) return res.status(409).json({ error: 'This is the only active administrator — make another user an administrator first.' });
      set.role = role;
    }
  }
  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') return res.status(400).json({ error: 'Invalid value for active.' });
    if (body.active !== user.active) {
      if (self) return res.status(400).json({ error: 'You cannot deactivate your own account.' });
      if (!body.active && await isLastActiveAdmin(user)) return res.status(409).json({ error: 'This is the only active administrator — it cannot be deactivated.' });
      set.active = body.active;
    }
  }
  if (!Object.keys(set).length) return res.json({ ok: true });

  const signOut = set.role !== undefined || set.active === false;
  try {
    await User.updateOne({ _id: user._id }, signOut ? { $set: set, $inc: { tokenVersion: 1 } } : { $set: set });
  } catch (e) {
    if (e && e.code === 11000) return res.status(409).json({ error: 'A user with that email already exists.' });
    throw e;
  }
  const details = { email: set.email || user.email, changed: Object.keys(set) };
  if (set.role) { details.fromRole = user.role; details.toRole = set.role; }
  if (set.active !== undefined) details.active = set.active;
  await audit.record({ user: req.user, action: 'user.updated', entity: 'user', entityId: user.id, ip: req.ip, details });
  if (set.role) {
    await audit.record({
      user: req.user, action: 'user.role_changed', entity: 'user', entityId: user.id, ip: req.ip, details: { email: details.email, from: ROLE_LABEL[user.role], to: ROLE_LABEL[set.role] },
    });
  }
  return res.json({ ok: true });
}

// Set a temporary password for another user (they should change it after
// signing in). Unlocks the account and signs it out everywhere.
async function resetUserPassword(req, res) {
  const user = await targetUser(req, res);
  if (!user) return null;
  const password = asString((req.body || {}).password);
  const weak = validatePassword(password, { email: user.email });
  if (weak) return res.status(400).json({ error: weak });
  const passwordHash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);
  await User.updateOne({ _id: user._id }, {
    $set: { passwordHash, passwordChangedAt: new Date(), failedLoginCount: 0 },
    $unset: { lockUntil: 1 },
    $inc: { tokenVersion: 1 },
  });
  await audit.record({
    user: req.user, action: 'user.password_reset', entity: 'user', entityId: user.id, ip: req.ip, details: { email: user.email },
  });
  return res.json({ ok: true });
}

async function deleteUser(req, res) {
  const user = await targetUser(req, res);
  if (!user) return null;
  if (await isLastActiveAdmin(user)) {
    return res.status(409).json({ error: 'This is the only active administrator — it cannot be deleted.' });
  }
  await User.deleteOne({ _id: user._id });
  // audit entries keep the actor's email, so history stays readable
  await audit.record({
    user: req.user, action: 'user.deleted', entity: 'user', entityId: user.id, ip: req.ip, details: { email: user.email, role: user.role },
  });
  return res.json({ ok: true });
}

module.exports = {
  login, me, logout, changePassword, createUser, listUsers, updateUser, resetUserPassword, deleteUser,
};
