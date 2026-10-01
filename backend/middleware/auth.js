/**
 * Session auth + CSRF + role guards.
 *
 * Session: a short-lived HS256 JWT in an HttpOnly, SameSite=Strict cookie
 * (Secure + "__Host-" prefix under HTTPS). JavaScript can never read it, and
 * it never appears in URLs or localStorage.
 *
 * Revocation: the JWT carries the user's `tokenVersion`; logout and password
 * changes bump it, so every previously issued session stops working.
 *
 * CSRF: every state-changing request (POST/PUT/PATCH/DELETE) must send
 * X-CSRF-Token = HMAC(secret, session jti). The token is given to the page in
 * the login / /auth/me JSON responses (which other origins cannot read) and
 * kept only in memory — SameSite=Strict is a second, independent layer.
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { isValidObjectId } = require('mongoose');
const env = require('../config/env');
const { User } = require('../models');
const logger = require('../utils/logger');

// At the root of its own domain the cookie uses the "__Host-" prefix (which
// requires Path=/). Under a sub-path of a shared domain (e.g. aun.edu.ng/payrol)
// it is scoped to that path instead, so the rest of the site never receives it.
const COOKIE_PATH = env.BASE_PATH || '/';
const COOKIE = !env.COOKIE_SECURE ? 'aun_session'
  : env.BASE_PATH ? '__Secure-aun_session' : '__Host-aun_session';
const ISSUER = 'aun-payroll';
const AUDIENCE = 'aun-payroll-web';
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const cookieOptions = () => ({
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: 'strict',
  path: COOKIE_PATH,
});

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) {
      const k = part.slice(0, i).trim();
      try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch (_) { /* ignore malformed */ }
    }
  });
  return out;
}

const csrfFor = (jti) => crypto.createHmac('sha256', env.JWT_SECRET).update(`csrf:${jti}`).digest('base64url');

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Start a session for `user`: set the HttpOnly cookie, return the CSRF token. */
function issueSession(res, user) {
  const jti = crypto.randomBytes(16).toString('base64url');
  const token = jwt.sign(
    { sub: String(user._id || user.id), tv: user.tokenVersion || 0 },
    env.JWT_SECRET,
    {
      algorithm: 'HS256', expiresIn: `${env.SESSION_TTL_HOURS}h`, issuer: ISSUER, audience: AUDIENCE, jwtid: jti,
    },
  );
  res.cookie(COOKIE, token, { ...cookieOptions(), maxAge: env.SESSION_TTL_HOURS * 3600 * 1000 });
  return csrfFor(jti);
}

function clearSession(res) {
  res.clearCookie(COOKIE, cookieOptions());
}

async function requireAuth(req, res, next) {
  let payload;
  try {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (!token) return res.status(401).json({ error: 'Authentication required.' });
    payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'], issuer: ISSUER, audience: AUDIENCE });
  } catch (e) {
    clearSession(res);
    return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
  }
  try {
    if (!isValidObjectId(payload.sub) || !payload.jti) throw new Error('bad claims');
    const user = await User.findOne({ _id: payload.sub, active: true });
    if (!user || (user.tokenVersion || 0) !== payload.tv) {
      clearSession(res);
      return res.status(401).json({ error: 'Your session is no longer valid. Please sign in again.' });
    }
    const csrf = csrfFor(payload.jti);
    if (UNSAFE_METHODS.has(req.method) && !safeEqual(req.get('x-csrf-token') || '', csrf)) {
      logger.warn('csrf_rejected', { path: req.path, method: req.method, ip: req.ip, user: user.email });
      return res.status(403).json({ error: 'Security check failed. Please refresh the page and try again.' });
    }
    req.user = {
      id: user.id, email: user.email, role: user.role, name: user.name,
    };
    req.session = { csrfToken: csrf };
    return next();
  } catch (e) {
    return next(e);
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required.' });
    if (!roles.includes(req.user.role)) {
      logger.warn('forbidden', { path: req.path, method: req.method, user: req.user.email, role: req.user.role });
      return res.status(403).json({ error: 'You do not have permission to perform this action.' });
    }
    return next();
  };
}

module.exports = {
  issueSession, clearSession, requireAuth, requireRole, COOKIE,
};
