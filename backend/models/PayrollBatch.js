/**
 * PayrollBatch — one per uploaded payroll workbook (the UI's "payroll run").
 *
 * Duplicate protection: the same file (SHA-256) can never be imported twice
 * for the same period — enforced by a unique index, not just app logic.
 */
const { Schema, model } = require('mongoose');
const {
  baseOptions, str, PERIOD_KEY_RE, SHA256_RE,
} = require('./common');

const STATUSES = ['uploaded', 'validated', 'generating', 'generated', 'sending', 'completed'];

const count = { type: Number, default: 0, min: 0 };

const countsSchema = new Schema({
  total: count,
  valid: count,
  invalid: count,
  generated: count,
  pending: count,
  sending: count,
  sent: count,
  failed: count,
  skipped: count,
}, { _id: false });

// Mirrors excelService.buildSummary() — explicit so nothing arbitrary is stored.
const validationSummarySchema = new Schema({
  total: count,
  valid: count,
  invalid: count,
  missingEmail: count,
  invalidEmail: count,
  missingId: count,
  missingName: count,
  invalidNumeric: count,
  duplicateId: count,
  duplicateEmail: count,
  reconcileWarnings: count,
  missingColumns: { type: [str(100)], default: [] },
}, { _id: false });

const payrollBatchSchema = new Schema({
  periodKey: str(7, { required: true, match: PERIOD_KEY_RE }), // "2026-09"
  periodLabel: str(40, { required: true }), // "September 2026"
  originalFilename: str(255),
  fileSha256: str(64, { required: true, match: SHA256_RE }),
  uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },

  status: { type: String, enum: STATUSES, default: 'validated' },
  legendDetected: { type: Boolean, default: false },

  counts: { type: countsSchema, default: () => ({}) },
  validationSummary: { type: validationSummarySchema, default: () => ({}) },

  generatedAt: Date,
  sendStartedAt: Date,
  completedAt: Date,
}, baseOptions);

payrollBatchSchema.index({ periodKey: 1, fileSha256: 1 }, { unique: true });
payrollBatchSchema.index({ periodKey: 1, createdAt: -1 });
payrollBatchSchema.index({ createdAt: -1 });

module.exports = model('PayrollBatch', payrollBatchSchema);
module.exports.STATUSES = STATUSES;
