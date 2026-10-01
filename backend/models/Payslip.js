/**
 * Payslip — one employee's payroll record AND pay advice for one batch.
 * (Payroll record and payslip are 1:1 and always read together, so they
 * share one document rather than two collections.)
 *
 * `advice` is the exact snapshot rendered by templates/payAdviceTemplate.js;
 * its shape mirrors excelService.buildEmployee(). Invalid rows are stored too
 * (valid=false, with issues) so the admin can see why they were skipped.
 */
const crypto = require('crypto');
const { Schema, model } = require('mongoose');
const {
  baseOptions, money, str, finiteNumber, SHA256_RE,
} = require('./common');

const lineSchema = new Schema({
  label: str(120, { required: true }),
  amount: money,
}, { _id: false });

const adviceSchema = new Schema({
  employee: {
    name: str(200),
    employeeId: str(64),
    department: str(200),
    designation: str(200),
    bank: str(120),
    accountNo: str(40),
  },
  bankTax: { tin: str(40) },
  pension: {
    pfaName: str(200),
    pensionPin: str(40),
    nhfNumber: str(40),
  },
  annualSalary: money,
  earnings: { type: [lineSchema], default: [] },
  deductions: { type: [lineSchema], default: [] },
  totals: {
    grossEarnings: money,
    grossDeductions: money,
    netPay: money,
  },
  reconciliation: {
    earningsSum: { type: Number, validate: finiteNumber },
    deductionsSum: { type: Number, validate: finiteNumber },
    earningsMatch: Boolean,
    deductionsMatch: Boolean,
    netMatch: Boolean,
  },
}, { _id: false });

/** Unique, non-sequential payslip reference, e.g. "PS-3F9A1C07D2B4". */
function newPayslipNo() {
  return `PS-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
}

const payslipSchema = new Schema({
  batch: { type: Schema.Types.ObjectId, ref: 'PayrollBatch', required: true },
  employee: { type: Schema.Types.ObjectId, ref: 'Employee' }, // absent for rows without an ID
  payslipNo: { type: String, required: true, default: newPayslipNo },
  rowNumber: { type: Number, min: 1 },

  // denormalised identity (list/search without joins)
  employeeId: str(64, { default: '' }),
  name: str(200, { default: '' }),
  // raw value from the "Email Address" column — may be invalid on invalid
  // rows (kept so the admin can see what was wrong); never sent unless valid
  email: str(254, { lowercase: true, default: '' }),
  department: str(200, { default: '' }),
  designation: str(200, { default: '' }),

  grossPay: money,
  totalDeductions: money,
  netPay: money,
  advice: { type: adviceSchema, required: true },

  valid: { type: Boolean, required: true },
  issues: {
    type: [str(300)],
    default: [],
    validate: { validator: (a) => a.length <= 50, message: 'Too many issues recorded' },
  },

  generatedAt: Date,
  pdfSha256: str(64, { match: SHA256_RE }), // integrity of the last generated PDF
}, baseOptions);

payslipSchema.index({ payslipNo: 1 }, { unique: true });
// One sendable payslip per employee per batch (invalid duplicates are kept
// for display only, so the constraint applies to valid rows).
payslipSchema.index(
  { batch: 1, employeeId: 1 },
  { unique: true, partialFilterExpression: { valid: true } },
);
payslipSchema.index({ batch: 1, rowNumber: 1 }, { unique: true });
payslipSchema.index({ batch: 1, valid: 1 });
payslipSchema.index({ employee: 1, createdAt: -1 });

module.exports = model('Payslip', payslipSchema);
module.exports.newPayslipNo = newPayslipNo;
