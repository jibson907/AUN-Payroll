/**
 * scripts/adminCli.js — create an administrator, or reset a user's password,
 * directly in MongoDB. The password is typed at a hidden prompt: it is never
 * stored in .env, files, shell history or logs.
 *
 *   npm run admin:create            create a new administrator
 *   npm run admin:reset-password    set a new password for an existing user
 */
const readline = require('readline');
const bcrypt = require('bcryptjs');
const mongo = require('../config/mongo');
const env = require('../config/env');
const { User } = require('../models');
const { validatePassword } = require('../utils/password');
const { isValidEmail } = require('../utils/validators');

// One shared readline for the whole session (a new interface per question
// would lose already-buffered input). While `muted`, typed characters are not
// echoed, so passwords never appear on screen.
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
let muted = false;
// eslint-disable-next-line no-underscore-dangle
const writeOut = rl._writeToOutput.bind(rl);
// eslint-disable-next-line no-underscore-dangle
rl._writeToOutput = (s) => { if (!muted) writeOut(s); };

// Queue input lines so none are lost (piped input can arrive all at once).
const lines = [];
const waiters = [];
let inputEnded = false;
rl.on('line', (l) => { if (waiters.length) waiters.shift()(l); else lines.push(l); });
rl.on('close', () => { inputEnded = true; while (waiters.length) waiters.shift()(null); });

function ask(question, { hidden = false } = {}) {
  process.stdout.write(question);
  muted = hidden;
  return new Promise((resolve) => {
    const done = (l) => {
      muted = false;
      if (hidden) process.stdout.write('\n');
      if (l === null) { console.error('\n  ✗ Input ended.'); process.exit(1); }
      resolve(l.trim());
    };
    if (lines.length) done(lines.shift());
    else if (inputEnded) done(null);
    else waiters.push(done);
  });
}

async function askPassword(email) {
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const pw = await ask('Password (min 12 characters, hidden): ', { hidden: true });
    const weak = validatePassword(pw, { email });
    if (weak) { console.log(`  ✗ ${weak}`); continue; } // eslint-disable-line no-continue
    // eslint-disable-next-line no-await-in-loop
    const again = await ask('Repeat password: ', { hidden: true });
    if (again !== pw) { console.log('  ✗ Passwords do not match.'); continue; } // eslint-disable-line no-continue
    return pw;
  }
}

async function create() {
  const name = await ask('Admin full name: ');
  const email = (await ask('Admin email: ')).toLowerCase();
  if (!name || name.length > 120) throw new Error('A name (max 120 characters) is required.');
  if (!isValidEmail(email)) throw new Error('That is not a valid email address.');
  const password = await askPassword(email);
  await mongo.connect();
  if (await User.exists({ email })) throw new Error('A user with that email already exists. Use: npm run admin:reset-password');
  const passwordHash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);
  await User.create({
    name, email, passwordHash, role: 'admin', active: true, passwordChangedAt: new Date(),
  });
  console.log(`  ✓ Administrator ${email} created. Sign in at the frontend.`);
}

async function resetPassword() {
  const email = (await ask('Email of the account to reset: ')).toLowerCase();
  if (!isValidEmail(email)) throw new Error('That is not a valid email address.');
  const password = await askPassword(email);
  await mongo.connect();
  const user = await User.findOne({ email });
  if (!user) throw new Error('No user with that email.');
  const passwordHash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);
  await User.updateOne({ _id: user._id }, {
    $set: {
      passwordHash, passwordChangedAt: new Date(), active: true, failedLoginCount: 0,
    },
    $unset: { lockUntil: 1 },
    $inc: { tokenVersion: 1 }, // sign out all existing sessions of this account
  });
  console.log(`  ✓ Password reset for ${email} (${user.role}).`);
}

const mode = process.argv[2];
const run = mode === 'reset-password' ? resetPassword : mode === 'create' ? create : null;
if (!run) {
  console.log('Usage: npm run admin:create | npm run admin:reset-password');
  process.exit(1);
}
run()
  .then(async () => { rl.close(); await mongo.disconnect(); process.exit(0); })
  .catch(async (e) => {
    rl.close();
    console.error(`  ✗ ${mongo.redact(e.message)}`);
    await mongo.disconnect().catch(() => {});
    process.exit(1);
  });
