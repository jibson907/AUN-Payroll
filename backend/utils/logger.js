/**
 * Minimal structured logger. Writes JSON lines to the console AND to
 * backend/logs/app.log. It deliberately does NOT log payroll figures or
 * employee financial data — only high-level events, ids and counts.
 */
const fs = require('fs');
const path = require('path');

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const CURRENT = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? 2;
const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'app.log');

// Size-based rotation: app.log → app.log.1 … app.log.5 (oldest dropped),
// so the log can never fill the server's disk.
const MAX_BYTES = 10 * 1024 * 1024;
const KEEP = 5;

let stream = null;
let bytes = 0;
function getStream() {
  if (stream) return stream;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    bytes = fs.existsSync(LOG_FILE) ? fs.statSync(LOG_FILE).size : 0;
    stream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
  } catch (_) {
    stream = null;
  }
  return stream;
}

function rotate() {
  try {
    stream.end();
    stream = null;
    for (let i = KEEP - 1; i >= 1; i -= 1) {
      const from = `${LOG_FILE}.${i}`;
      if (fs.existsSync(from)) fs.renameSync(from, `${LOG_FILE}.${i + 1}`);
    }
    fs.renameSync(LOG_FILE, `${LOG_FILE}.1`);
  } catch (_) { /* keep logging to console even if rotation fails */ }
  stream = null;
}

function emit(level, msg, meta) {
  if (LEVELS[level] > CURRENT) return;
  const line = { t: new Date().toISOString(), level, msg };
  if (meta && typeof meta === 'object') Object.assign(line, meta);
  const text = JSON.stringify(line);
  const out = level === 'error' ? console.error : console.log;
  out(text);
  const s = getStream();
  if (s) {
    try { s.write(`${text}\n`); bytes += Buffer.byteLength(text) + 1; } catch (_) { /* ignore */ }
    if (bytes > MAX_BYTES) rotate();
  }
}

module.exports = {
  error: (m, meta) => emit('error', m, meta),
  warn: (m, meta) => emit('warn', m, meta),
  info: (m, meta) => emit('info', m, meta),
  debug: (m, meta) => emit('debug', m, meta),
};
