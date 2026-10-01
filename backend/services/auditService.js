/** Audit logging — records every payroll action with non-sensitive metadata. */
const { isValidObjectId } = require('mongoose');
const { AuditLog } = require('../models');
const logger = require('../utils/logger');

async function record({
  user, action, entity = null, entityId = null, details = null, ip = null,
}) {
  try {
    await AuditLog.create({
      user: user && isValidObjectId(user.id) ? user.id : undefined,
      actorEmail: user?.email || undefined,
      action,
      entity: entity || undefined,
      entityId: entityId != null ? String(entityId) : undefined,
      details: details || undefined,
      ip: ip || undefined,
    });
    logger.info('audit', {
      action, entity, entityId, actor: user?.email,
    });
  } catch (e) {
    logger.error('audit_failed', { action, error: e.message });
  }
}

/** API shape expected by the frontend (snake_case, `id`). */
function toApi(r) {
  return {
    id: String(r._id),
    user_id: r.user ? String(r.user) : null,
    actor_email: r.actorEmail || null,
    action: r.action,
    entity: r.entity || null,
    entity_id: r.entityId || null,
    details: r.details || null,
    ip: r.ip || null,
    created_at: r.createdAt,
  };
}

async function list({ limit = 100, offset = 0 } = {}) {
  const rows = await AuditLog.find().sort({ createdAt: -1, _id: -1 }).skip(offset).limit(limit)
    .lean();
  return rows.map(toApi);
}

module.exports = { record, list };
