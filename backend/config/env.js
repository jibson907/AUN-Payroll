/** Central, validated environment configuration (MongoDB Atlas setup). */
const path = require('path');
require('dotenv').config();

function bool(v, def = false) {
  if (v === undefined || v === null || v === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

const ROOT = path.join(__dirname, '..'); // backend/

const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: Number(process.env.PORT || 5000),

  // Backend storage folder (never web-served). Uploaded workbooks and payslip
  // PDFs are processed in memory only and never written to disk.
  LOG_DIR: process.env.LOG_DIR || path.join(ROOT, 'logs'),

  // ── MongoDB Atlas ─────────────────────────────────────────
  // Backend-only secret. Never logged, never returned by the API.
  MONGODB_URI: process.env.MONGODB_URI || '',
  // Optional: overrides the database name in the URI path.
  MONGODB_DB_NAME: process.env.MONGODB_DB_NAME || '',
  MONGODB_MAX_POOL: Number(process.env.MONGODB_MAX_POOL || 10),
  // Optional, comma-separated (e.g. "8.8.8.8,1.1.1.1") — only if the local
  // DNS resolver refuses mongodb+srv SRV lookups.
  MONGODB_DNS_SERVERS: (process.env.MONGODB_DNS_SERVERS || '').split(',').map((s) => s.trim()).filter(Boolean),

  // Auth
  // No fallback secrets in code — see assertSecrets() below.
  JWT_SECRET: process.env.JWT_SECRET || '',
  // Session lifetime (hours) — the JWT and its HttpOnly cookie expire together.
  SESSION_TTL_HOURS: Math.min(24, Math.max(1, Number(process.env.SESSION_TTL_HOURS) || 8)),
  // Inactivity timeout (minutes): a session not used for this long ends, on the
  // server (cookie/JWT expiry) and in the browser (idle sign-out). 2–60, default 10.
  SESSION_IDLE_MINUTES: Math.min(60, Math.max(2, Number(process.env.SESSION_IDLE_MINUTES) || 10)),
  // Secure cookies require HTTPS. ON in production; can be forced with COOKIE_SECURE.
  COOKIE_SECURE: bool(process.env.COOKIE_SECURE, (process.env.NODE_ENV || 'development') === 'production'),
  // Number of reverse proxies in front of the API (0 = none). Only trust
  // X-Forwarded-For when a real proxy sets it, or IP rate limits can be bypassed.
  TRUST_PROXY: Math.max(0, Math.floor(Number(process.env.TRUST_PROXY) || 0)),
  // Brute-force protection
  LOGIN_MAX_FAILURES: Math.max(3, Number(process.env.LOGIN_MAX_FAILURES) || 5),
  LOGIN_LOCK_MINUTES: Math.max(5, Number(process.env.LOGIN_LOCK_MINUTES) || 15),
  // bcrypt work factor: never below 12 (OWASP guidance), max 15 (login latency).
  BCRYPT_ROUNDS: Math.min(15, Math.max(12, Number(process.env.BCRYPT_ROUNDS) || 12)),

  // Production: serve the built React app (frontend/dist) from this server,
  // so the app and API share one origin.
  SERVE_FRONTEND: bool(process.env.SERVE_FRONTEND, (process.env.NODE_ENV || 'development') === 'production'),
  FRONTEND_DIST: process.env.FRONTEND_DIST || path.join(ROOT, '..', 'frontend', 'dist'),

  // Optional sub-path the app is published under, e.g. "/payrol" for
  // https://aun.edu.ng/payrol ('' = root of the domain). The frontend must be
  // built with the same BASE_PATH.
  BASE_PATH: (process.env.BASE_PATH || '').trim().replace(/\/+$/, ''),

  // CORS — the React dev server
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:5173',

  // SMTP / email
  SMTP_HOST: process.env.SMTP_HOST || '',
  SMTP_PORT: Number(process.env.SMTP_PORT || 587),
  SMTP_SECURE: bool(process.env.SMTP_SECURE, false),
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASSWORD: process.env.SMTP_PASSWORD || '',
  SMTP_FROM: process.env.SMTP_FROM || '',

  // Optional monitored inbox for staff replies (emails say 'do not reply').
  EMAIL_REPLY_TO: process.env.EMAIL_REPLY_TO || '',

  // Controlled delivery (≈1,000 staff ≈ 15 min with the defaults)
  EMAIL_BATCH_SIZE: Math.min(500, Math.max(1, Number(process.env.EMAIL_BATCH_SIZE) || 50)),
  EMAIL_CONCURRENCY: Math.min(5, Math.max(1, Number(process.env.EMAIL_CONCURRENCY) || 2)),
  EMAIL_BATCH_PAUSE_MS: Math.max(0, Number(process.env.EMAIL_BATCH_PAUSE_MS ?? 30000)),
  // Temporary send problems are retried automatically after these waits (ms);
  // only after the last one is the employee marked failed.
  EMAIL_RETRY_DELAYS_MS: String(process.env.EMAIL_RETRY_DELAYS_MS || '60000,180000,300000')
    .split(',').map((s) => Math.max(0, Number(s.trim()) || 0)).slice(0, 5),

  // Jobs / uploads
  JOB_CONCURRENCY: Math.min(8, Math.max(1, Number(process.env.JOB_CONCURRENCY) || 4)), // PDF generation
  MAX_UPLOAD_MB: Math.min(25, Math.max(1, Number(process.env.MAX_UPLOAD_MB) || 10)),
  // Workbook shape limits (≈1,000 staff fits comfortably)
  MAX_ROWS: Math.max(100, Number(process.env.MAX_ROWS) || 5000),
  UPLOAD_LIMIT_PER_15MIN: Math.max(1, Number(process.env.UPLOAD_LIMIT_PER_15MIN) || 20),
  MAX_COLUMNS: Math.max(50, Number(process.env.MAX_COLUMNS) || 300),
};

// Publicly documented placeholder values — rejected even with a suffix added.
const WEAK_SECRETS = ['change_this_secret', 'put_a_long_random_string_here', 'changeme'];

/**
 * Called by the API server at boot: refuse to start with missing or weak
 * secrets instead of silently falling back to a publicly known value.
 */
env.assertSecrets = function assertSecrets() {
  const s = env.JWT_SECRET;
  if (!s || s.length < 32 || WEAK_SECRETS.some((w) => s.toLowerCase().includes(w))) {
    throw new Error('JWT_SECRET is missing or too weak (min 32 random characters). Set it in backend/.env.');
  }
  // Credentialed (cookie) CORS must name explicit origins — never a wildcard.
  if (!env.FRONTEND_URL || env.FRONTEND_URL.split(',').some((o) => o.trim() === '*' || !/^https?:\/\/[^/*]+$/.test(o.trim()))) {
    throw new Error('FRONTEND_URL must list explicit origins (e.g. https://payroll.aun.edu.ng), comma-separated, no "*".');
  }
  if (env.BASE_PATH && !/^(\/[A-Za-z0-9._-]+)+$/.test(env.BASE_PATH)) {
    throw new Error('BASE_PATH must look like "/payrol" (leading slash, no trailing slash, no spaces).');
  }
  if (env.NODE_ENV === 'production' && !env.COOKIE_SECURE) {
    throw new Error('COOKIE_SECURE must be true in production (HTTPS only).');
  }
};

module.exports = env;
