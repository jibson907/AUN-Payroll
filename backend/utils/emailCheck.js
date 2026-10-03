/**
 * emailCheck.js — catch mistyped recipient addresses BEFORE sending, and
 * sort send errors into "the address is wrong" vs "try again later".
 *
 * Only address problems should mark an employee as failed; temporary
 * problems (network, "try again later", PDF engine hiccups) are retried.
 */
const dns = require('dns').promises;

// Popular mail domains staff are likely to use → near-misses are typos.
const KNOWN = ['aun.edu.ng', 'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'yahoo.co.uk'];
// Real domains that happen to look like a known one (never flagged).
const REAL_LOOKALIKES = new Set(['mail.com', 'gmx.com', 'ymail.com', 'live.com', 'aol.com', 'msn.com', 'me.com',
  'email.com', 'yahoo.fr', 'yahoo.ca', 'outlook.fr', 'hotmail.fr', 'hotmail.co.uk', 'rocketmail.com', 'googlemail.com']);

/** Levenshtein distance, early exit above `max`. */
function distance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** "gmial.com" → "gmail.com"; null when the domain is not a near-miss. */
function likelyTypoOf(domain) {
  const d = String(domain || '').toLowerCase();
  if (KNOWN.includes(d) || REAL_LOOKALIKES.has(d)) return null;
  for (const k of KNOWN) {
    const max = k.length >= 9 ? 2 : 1;
    if (distance(d, k, max) <= max) return k;
  }
  return null;
}

const domainCache = new Map(); // domain → { ok, reason, at }
const CACHE_MS = 30 * 60 * 1000;

/**
 * Does this address's domain exist and accept email?
 * Returns { ok: true } or { ok: false, reason }. DNS outages never fail an
 * address (they return ok: true and the send itself decides).
 */
async function checkRecipientDomain(email) {
  const domain = String(email).split('@').pop().toLowerCase();
  const typo = likelyTypoOf(domain);
  if (typo) return { ok: false, reason: `The email domain "${domain}" looks like a typo of "${typo}".` };

  const hit = domainCache.get(domain);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit;

  let result = { ok: true };
  try {
    const mx = await dns.resolveMx(domain);
    if (mx.length === 1 && (!mx[0].exchange || mx[0].exchange === '.')) {
      result = { ok: false, reason: `The email domain "${domain}" does not accept email.` };
    }
  } catch (e) {
    if (e.code === 'ENOTFOUND' || e.code === 'ENODATA') {
      // no MX record: mail falls back to the domain's own address, if it has one
      try {
        await dns.resolve4(domain);
      } catch (e2) {
        if (e2.code === 'ENOTFOUND' || e2.code === 'ENODATA') {
          result = { ok: false, reason: `The email domain "${domain}" does not exist — check the address for a typo.` };
        }
      }
    }
    // other DNS errors (timeout, server failure) → not the address's fault
  }
  domainCache.set(domain, { ...result, at: Date.now() });
  return result;
}

/**
 * Sort a send error:
 *   'address'   — the recipient address is wrong (typo, unknown mailbox): fail it
 *   'system'    — the sending account itself can't send right now (bad login,
 *                 daily limit): pause the whole run, fail nobody
 *   'temporary' — anything else: retry later
 */
function classifySendError(e) {
  if (e && e.kind) return e.kind;
  const code = e && e.code;
  const rc = Number(e && e.responseCode) || 0;
  const text = String((e && (e.response || e.message)) || '');
  if (code === 'EMAIL_NOT_CONFIGURED' || code === 'EAUTH' || rc === 535 || rc === 534 || rc === 530) return 'system';
  if (/daily user sending|sending quota|quota exceeded|sending limit/i.test(text)) return 'system';
  if (rc >= 500 && (e.command === 'RCPT TO' || code === 'EENVELOPE'
    || /5\.1\.\d|user unknown|no such user|does not exist|invalid recipient|recipient address rejected|address rejected|bad destination/i.test(text))) {
    return 'address';
  }
  return 'temporary';
}

module.exports = { checkRecipientDomain, classifySendError, likelyTypoOf };
