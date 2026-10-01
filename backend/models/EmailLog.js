/**
 * EmailLog — delivery record for exactly one payslip, and the email queue.
 *
 *   PENDING  → claimed atomically by the worker → SENDING → SENT | FAILED
 *   SKIPPED  → invalid row / missing or invalid email (never sent)
 *
 * The unique index on `payslip` guarantees one delivery record per payslip,
 * so re-processing can never create duplicate email records.
 */
const { Schema, model } = require('mongoose');
const { baseOptions, str } = require('./common');

const STATUSES = ['PENDING', 'SENDING', 'SENT', 'FAILED', 'SKIPPED'];
const MAX_ATTEMPT_HISTORY = 20;

const attemptSchema = new Schema({
  at: { type: Date, required: true },
  outcome: { type: String, enum: ['sent', 'failed'], required: true },
  provider: str(20),
  error: str(500),
  messageId: str(200),
}, { _id: false });

const emailLogSchema = new Schema({
  payslip: { type: Schema.Types.ObjectId, ref: 'Payslip', required: true },
  batch: { type: Schema.Types.ObjectId, ref: 'PayrollBatch', required: true },
  employee: { type: Schema.Types.ObjectId, ref: 'Employee' },

  employeeId: str(64, { default: '' }),
  employeeName: str(200, { default: '' }),
  email: str(254, { lowercase: true, default: '' }), // intended recipient (from Excel)
  period: str(40, { required: true }),

  status: {
    type: String, enum: STATUSES, default: 'PENDING', required: true,
  },
  attemptCount: { type: Number, default: 0, min: 0 },
  lastAttemptAt: Date,
  nextAttemptAt: Date, // back-off for automatic retries of transient errors
  sentAt: Date,
  failureReason: str(500),

  provider: str(20),
  providerMessageId: str(200),
  deliveredTo: str(254, { lowercase: true }), // address the provider accepted

  // queue claim (crash recovery: stale SENDING rows are detected by lockedAt)
  lockedAt: Date,
  lockOwner: str(100),

  attempts: {
    type: [attemptSchema],
    default: [],
    validate: {
      validator: (a) => a.length <= MAX_ATTEMPT_HISTORY,
      message: `At most ${MAX_ATTEMPT_HISTORY} attempts are kept`,
    },
  },
}, baseOptions);

emailLogSchema.index({ payslip: 1 }, { unique: true });
emailLogSchema.index({ batch: 1, status: 1 });
emailLogSchema.index({ status: 1, nextAttemptAt: 1 }); // worker: next PENDING
emailLogSchema.index({ status: 1, lockedAt: 1 }); // recovery: stale SENDING

module.exports = model('EmailLog', emailLogSchema);
module.exports.STATUSES = STATUSES;
module.exports.MAX_ATTEMPT_HISTORY = MAX_ATTEMPT_HISTORY;
