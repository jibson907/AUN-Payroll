/**
 * scripts/checkMongo.js — verify the MongoDB Atlas connection from backend/.env.
 * Usage:  npm run db:check
 *
 * Connects, pings, does a write/read/delete round-trip in a scratch collection,
 * and reports the database user's roles so over-privileged users are spotted.
 * Never prints the connection string or password.
 */
const mongo = require('../config/mongo');

const BROAD_ROLES = ['root', 'atlasAdmin', 'dbAdminAnyDatabase', 'readWriteAnyDatabase', 'userAdminAnyDatabase', 'clusterAdmin'];

async function main() {
  const conn = await mongo.connect();
  const { db } = conn;
  const info = mongo.describeUri(process.env.MONGODB_URI);

  const build = await db.admin().command({ buildInfo: 1 }).catch(() => ({}));
  console.log(`  ✓ Connected to ${info.host}`);
  console.log(`    database: ${db.databaseName}   server: MongoDB ${build.version || '?'}   TLS: ${info.tls ? 'yes' : 'no (local only)'}`);

  // write → read → delete round-trip (proves the user can use this database)
  const scratch = db.collection('_connection_check');
  const { insertedId } = await scratch.insertOne({ at: new Date() });
  const found = await scratch.findOne({ _id: insertedId });
  await scratch.deleteOne({ _id: insertedId });
  await scratch.drop().catch(() => {});
  console.log(`  ✓ Write/read/delete round-trip ${found ? 'succeeded' : 'FAILED'}`);

  // privilege report
  const status = await db.command({ connectionStatus: 1 }).catch(() => null);
  const roles = (status && status.authInfo && status.authInfo.authenticatedUserRoles) || [];
  if (roles.length) {
    console.log(`    user roles: ${roles.map((r) => `${r.role}@${r.db}`).join(', ')}`);
    const broad = roles.filter((r) => BROAD_ROLES.includes(r.role));
    if (broad.length) {
      console.log(`  ⚠ This user has broad privileges (${broad.map((r) => r.role).join(', ')}).`);
      console.log(`    For production, use a dedicated user with only readWrite on "${db.databaseName}".`);
    }
  }
  await mongo.disconnect();
}

main().then(() => process.exit(0)).catch(async (e) => {
  console.error(`  ✗ ${mongo.redact(e.message)}`);
  await mongo.disconnect().catch(() => {});
  process.exit(1);
});
