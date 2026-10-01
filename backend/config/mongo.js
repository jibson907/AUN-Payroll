/**
 * config/mongo.js — the single MongoDB Atlas connection (Mongoose).
 *
 * SECURITY:
 *  - The URI comes only from MONGODB_URI (backend .env). It is never logged:
 *    only the host is reported, and driver error messages are redacted.
 *  - Remote hosts must use TLS (mongodb+srv:// implies TLS; plain mongodb://
 *    to a non-local host must set tls=true).
 *  - strictQuery: filter keys not in a schema are dropped, not passed through.
 */
const dns = require('dns');
const mongoose = require('mongoose');
const env = require('./env');
const logger = require('../utils/logger');

mongoose.set('strictQuery', true);
// Build indexes explicitly at boot (see syncIndexes) rather than implicitly
// on every model compile, which is the recommended production setting.
mongoose.set('autoIndex', false);
// Likewise, collections are created explicitly (with their indexes) at boot,
// not as a side effect of loading a model file.
mongoose.set('autoCreate', false);

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1'];

/** Parse the URI just enough to validate it and to log the host safely. */
function describeUri(uri) {
  const m = /^(mongodb(?:\+srv)?):\/\/(?:[^@/]*@)?([^/?]+)(\/[^?]*)?(\?.*)?$/.exec(uri || '');
  if (!m) return null;
  const params = new URLSearchParams((m[4] || '').slice(1));
  const hosts = m[2].split(',').map((h) => h.replace(/:\d+$/, '').replace(/^\[|\]$/g, ''));
  return {
    scheme: m[1],
    host: m[2],
    local: hosts.every((h) => LOCAL_HOSTS.includes(h)),
    tls: m[1] === 'mongodb+srv' || ['true', '1'].includes((params.get('tls') || params.get('ssl') || '').toLowerCase()),
  };
}

/** Remove anything that looks like credentials from a message before logging. */
function redact(msg) {
  return String(msg || '').replace(/(mongodb(?:\+srv)?:\/\/)[^@\s]*@/gi, '$1<redacted>@');
}

function validateUri(uri) {
  if (!uri) {
    throw new Error('MONGODB_URI is not set. Add it to backend/.env (see .env.example).');
  }
  const d = describeUri(uri);
  if (!d) throw new Error('MONGODB_URI is not a valid mongodb:// or mongodb+srv:// connection string.');
  if (!d.local && !d.tls) {
    throw new Error('MONGODB_URI points to a remote host without TLS. Use mongodb+srv:// or add tls=true.');
  }
  return d;
}

async function connect() {
  const d = validateUri(env.MONGODB_URI);
  // Some routers/local resolvers refuse the SRV lookup that mongodb+srv://
  // needs (querySrv ECONNREFUSED). Opt-in override of Node's DNS servers.
  if (env.MONGODB_DNS_SERVERS.length) dns.setServers(env.MONGODB_DNS_SERVERS);
  closing = false;
  try {
    await mongoose.connect(env.MONGODB_URI, {
      dbName: env.MONGODB_DB_NAME || undefined,
      maxPoolSize: env.MONGODB_MAX_POOL,
      serverSelectionTimeoutMS: 30000,
      retryWrites: true,
    });
  } catch (e) {
    throw new Error(`Cannot connect to MongoDB at ${d.host}: ${redact(e.message)}`);
  }
  logger.info('mongo_connected', { host: d.host, db: mongoose.connection.name });
  return mongoose.connection;
}

let closing = false;
async function disconnect() {
  closing = true;
  await mongoose.disconnect();
}

/** Health check — true when the server answers a ping. */
async function checkConnection() {
  try {
    if (mongoose.connection.readyState !== 1) return false;
    await mongoose.connection.db.admin().ping();
    return true;
  } catch (e) {
    return false;
  }
}

/** Create/refresh the indexes declared on every registered model. */
async function syncIndexes() {
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
}

// Surface connection loss/recovery after boot (never includes the URI).
mongoose.connection.on('disconnected', () => { if (!closing) logger.warn('mongo_disconnected'); });
mongoose.connection.on('reconnected', () => logger.info('mongo_reconnected'));
mongoose.connection.on('error', (e) => logger.error('mongo_error', { error: redact(e.message) }));

module.exports = {
  mongoose, connect, disconnect, checkConnection, syncIndexes, describeUri, redact, validateUri,
};
