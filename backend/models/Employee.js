/**
 * Employee — staff directory, upserted from each payroll upload by Employee ID
 * ("Employee ID No" in the workbook; AUN's staff ID).
 *
 * Deliberately holds NO financial or bank/pension data — those live only in
 * each Payslip's snapshot for the period they belong to.
 */
const { Schema, model } = require('mongoose');
const { baseOptions, emailFormat, str } = require('./common');

const employeeSchema = new Schema({
  employeeId: str(64, { required: true }),
  name: str(200, { required: true }),
  email: str(254, { lowercase: true, validate: emailFormat }),
  department: str(200),
  designation: str(200),
  lastBatch: { type: Schema.Types.ObjectId, ref: 'PayrollBatch' },
  lastSeenAt: Date,
}, baseOptions);

employeeSchema.index({ employeeId: 1 }, { unique: true });
employeeSchema.index({ email: 1 });

module.exports = model('Employee', employeeSchema);
