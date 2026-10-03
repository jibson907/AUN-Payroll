// Central API client — cookie session + CSRF header, JSON handling, one base URL.
//
// The session lives in an HttpOnly cookie that JavaScript cannot read. The
// CSRF token (from /auth/login or /auth/me) is kept only in memory — never in
// localStorage — and sent on every state-changing request.
import { API_URL, LOGIN_PATH, TOKEN_KEY } from '../config';

let csrfToken = null;
export function setCsrfToken(t) {
  csrfToken = t || null;
}

// Remove any bearer token left in localStorage by older versions of the app.
try { localStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ }

const SAFE_METHODS = ['GET', 'HEAD'];
const UNREACHABLE = 'The payroll server is not reachable right now. Please try again shortly or contact IT support.';

// Used only when the server's reply has no message of its own.
const STATUS_MESSAGES = {
  401: 'Your session has expired. Please sign in again.',
  403: 'You do not have permission to do this.',
  404: 'The requested item or service was not found.',
  429: 'Too many requests. Please wait a minute and try again.',
  500: 'The payroll server had a problem. Please try again or contact IT support.',
};
const messageFor = (data, status) => (data && data.error) || STATUS_MESSAGES[status] || `Request failed (${status})`;

async function request(method, path, body, opts = {}) {
  const headers = {};
  if (!SAFE_METHODS.includes(method) && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  // automatic polling must not count as user activity (inactivity sign-out)
  if (opts.background) headers['X-Background'] = '1';

  let payload = body;
  if (body && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method, headers, body: payload, credentials: 'include',
    });
  } catch {
    throw Object.assign(new Error(UNREACHABLE), { status: 0 });
  }
  // 502/503/504 come from the proxy/gateway when the server itself is down
  if ([502, 503, 504].includes(res.status)) {
    throw Object.assign(new Error(UNREACHABLE), { status: res.status });
  }

  if (opts.raw) {
    if (!res.ok) throw await toError(res);
    return res;
  }

  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const err = new Error(messageFor(data, res.status));
    err.status = res.status;
    if (res.status === 401 && !path.startsWith('/auth/login') && !path.startsWith('/auth/me')) {
      setCsrfToken(null);
      if (!location.pathname.startsWith(LOGIN_PATH)) location.href = LOGIN_PATH;
    }
    throw err;
  }
  return data;
}

function safeJson(t) { try { return JSON.parse(t); } catch { return null; } }
async function toError(res) {
  const t = await res.text().catch(() => '');
  const d = safeJson(t);
  const e = new Error(messageFor(d, res.status));
  e.status = res.status;
  return e;
}

export const api = {
  get: (p, opts) => request('GET', p, null, opts),
  post: (p, b) => request('POST', p, b),
  put: (p, b) => request('PUT', p, b),
  del: (p) => request('DELETE', p),
  getRaw: (p) => request('GET', p, null, { raw: true }), // for PDF blobs
  upload: (p, formData) => request('POST', p, formData),
  base: API_URL,
};
