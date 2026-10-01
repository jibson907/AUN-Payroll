/**
 * models/index.js — registers every Mongoose model (so syncIndexes() sees
 * them all) and re-exports them.
 */
module.exports = {
  User: require('./User'),
  Employee: require('./Employee'),
  PayrollBatch: require('./PayrollBatch'),
  Payslip: require('./Payslip'),
  EmailLog: require('./EmailLog'),
  AuditLog: require('./AuditLog'),
};
