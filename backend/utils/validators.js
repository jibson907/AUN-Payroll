/** Shared validation helpers. */

// Strict "plain mailbox" check. Deliberately rejects quotes, commas,
// semicolons, angle brackets, parentheses, spaces and control characters:
// mail libraries interpret those as display names, comments or address
// LISTS, which could deliver a payslip to a different or extra recipient
// (e.g. 'jib"rin@aun.edu.ng' would be sent to 'rin@aun.edu.ng').
const EMAIL_RE = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;

function isValidEmail(v) {
  if (typeof v !== 'string') return false;
  const s = v.trim();
  if (s.length > 254) return false;
  const at = s.lastIndexOf('@');
  if (at < 1 || at > 64) return false; // local part 1..64 chars
  return EMAIL_RE.test(s);
}

// Code points replaced by a space: C0/C1 controls (incl. CR/LF/TAB), zero-width
// characters, Unicode line/paragraph separators and the BOM.
const INVISIBLE_RANGES = [[0x00, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x2029], [0xfeff, 0xfeff]];
const isInvisible = (cp) => INVISIBLE_RANGES.some(([a, b]) => cp >= a && cp <= b);

/** Remove control/invisible characters and collapse whitespace. */
function cleanText(v) {
  let out = '';
  for (const ch of String(v == null ? '' : v)) out += isInvisible(ch.codePointAt(0)) ? ' ' : ch;
  return out.replace(/\s+/g, ' ').trim();
}

function isBlank(v) {
  return v === null || v === undefined || String(v).trim() === '';
}

/** A valid AUN payroll period label, e.g. "June 2026". */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function isValidPeriod(v) {
  if (isBlank(v)) return false;
  const m = String(v).trim().match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (!m) return false;
  return MONTHS.includes(m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase()) && Number(m[2]) >= 2000;
}

/** period -> filename-safe token, e.g. "June 2026" -> "June_2026" */
function periodSlug(period) {
  return String(period).trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_]/g, '');
}

/** Make any string safe for a filename. */
function safeFilePart(s) {
  return String(s || '').trim().replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'x';
}

module.exports = {
  isValidEmail, cleanText, isBlank, isValidPeriod, periodSlug, safeFilePart, MONTHS,
};
