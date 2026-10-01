/**
 * User — payroll system accounts. Only a logged-in admin can create accounts
 * (admins, payroll officers, viewers) from Settings → Payroll Users; there is
 * no public sign-up. The first admin is created with `npm run admin:create` —
 * never from .env credentials.
 */
const { Schema, model } = require('mongoose');
const { baseOptions, emailFormat, str } = require('./common');

const ROLES = ['admin', 'payroll_officer', 'viewer'];

const userSchema = new Schema({
  name: str(120, { required: true }),
  email: str(254, {
    required: true, lowercase: true, validate: emailFormat,
  }),
  // bcrypt hash — excluded from every query unless explicitly selected
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ROLES, default: 'admin', required: true },
  active: { type: Boolean, default: true },

  lastLoginAt: Date,
  passwordChangedAt: Date,
  // brute-force protection (per account)
  failedLoginCount: { type: Number, default: 0, min: 0 },
  lockUntil: Date,
  // bumped on logout / password change → invalidates issued tokens
  tokenVersion: { type: Number, default: 0, min: 0 },
}, baseOptions);

userSchema.index({ email: 1 }, { unique: true });

module.exports = model('User', userSchema);
module.exports.ROLES = ROLES;
