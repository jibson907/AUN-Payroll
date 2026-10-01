/**
 * Safe numeric coercion for payroll values.
 * Handles: blank cells, null, currency symbols (₦), commas, whitespace,
 * parentheses-as-negative, decimals. NEVER silently corrupts a real number.
 *
 * Returns { value: number|null, ok: boolean, raw }.
 *  - blank / null  -> { value: 0, ok: true }   (treated as zero, valid)
 *  - garbage text  -> { value: null, ok: false } (flagged as invalid)
 */
function parseAmount(raw) {
  if (raw === null || raw === undefined || raw === '') {
    return { value: 0, ok: true, raw };
  }
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? { value: raw, ok: true, raw } : { value: null, ok: false, raw };
  }
  let s = String(raw).trim();
  if (s === '' || s === '-' || s.toLowerCase() === 'n/a' || s.toLowerCase() === 'nil') {
    return { value: 0, ok: true, raw };
  }
  let negative = false;
  // (1,234.56) => negative
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  // strip currency symbols and commas and spaces
  s = s.replace(/[₦NGN]/gi, '').replace(/,/g, '').replace(/\s/g, '');
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  }
  if (s === '') return { value: 0, ok: true, raw };
  if (!/^\d*\.?\d+$/.test(s)) {
    return { value: null, ok: false, raw };
  }
  const num = parseFloat(s) * (negative ? -1 : 1);
  return Number.isFinite(num) ? { value: num, ok: true, raw } : { value: null, ok: false, raw };
}

/** True when a parsed optional (blue) value should be DISPLAYED on the advice. */
function hasMeaningfulValue(parsed) {
  return parsed.ok && parsed.value !== null && Math.abs(parsed.value) > 0.0049;
}

module.exports = { parseAmount, hasMeaningfulValue };
