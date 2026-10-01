/**
 * AuditLog — every security-relevant and payroll action. `details` holds
 * non-sensitive metadata only (ids, counts, flags) — never salaries,
 * passwords or tokens.
 */
const { Schema, model } = require('mongoose');
const { toJSON, str } = require('./common');

const auditLogSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User' },
  actorEmail: str(254, { lowercase: true }),
  action: str(128, { required: true }),
  entity: str(64),
  entityId: str(64),
  details: { type: Schema.Types.Mixed },
  ip: str(64),
}, { timestamps: { createdAt: true, updatedAt: false }, toJSON, toObject: toJSON, strict: true });

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ user: 1, createdAt: -1 });

module.exports = model('AuditLog', auditLogSchema);
