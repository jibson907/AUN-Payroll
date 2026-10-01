/**
 * models/common.js — shared schema options and validators for all models.
 */
const { isValidEmail } = require('../utils/validators');

/**
 * JSON output: expose `id` (string) instead of `_id`, drop `__v`, and never
 * serialise password hashes even if one was explicitly selected.
 */
const toJSON = {
  virtuals: true,
  versionKey: false,
  transform(doc, ret) {
    delete ret._id;
    delete ret.passwordHash;
    return ret;
  },
};

const baseOptions = { timestamps: true, toJSON, toObject: toJSON, strict: true };

const finiteNumber = {
  validator: (v) => v === null || v === undefined || Number.isFinite(v),
  message: '{PATH} must be a finite number',
};

const emailFormat = {
  validator: (v) => v === undefined || v === null || v === '' || isValidEmail(v),
  message: '{PATH} is not a valid email address',
};

/** Money: plain Number rounded to 2dp (source values are Excel doubles). */
const money = {
  type: Number,
  default: 0,
  validate: finiteNumber,
  set: (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : v),
};

/** Trimmed, length-capped string. */
const str = (maxlength, extra = {}) => ({ type: String, trim: true, maxlength, ...extra });

const PERIOD_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const SHA256_RE = /^[a-f0-9]{64}$/;

module.exports = {
  toJSON, baseOptions, finiteNumber, emailFormat, money, str, PERIOD_KEY_RE, SHA256_RE,
};
