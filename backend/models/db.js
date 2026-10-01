/**
 * models/db.js — MongoDB lifecycle used at boot: connect and build indexes.
 * The connection itself lives in config/mongo.js.
 *
 * No admin is ever created from .env credentials. Admin accounts are created
 * with `npm run admin:create` (scripts/adminCli.js) or by an existing admin
 * in Settings → Payroll Users.
 */
const mongo = require('../config/mongo');
const logger = require('../utils/logger');
const { User } = require('./index');

/** Full boot sequence: connect → create collections + indexes. */
async function bootstrap() {
  await mongo.connect();
  await mongo.syncIndexes();
  if (!(await User.exists({ role: 'admin', active: true }))) {
    logger.warn('no_admin_account', { advice: 'Create one with: npm run admin:create (in backend/)' });
  }
}

module.exports = {
  bootstrap,
  checkConnection: mongo.checkConnection,
  disconnect: mongo.disconnect,
};
