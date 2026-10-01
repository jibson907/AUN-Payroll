/**
 * Password policy (NIST SP 800-63B / OWASP ASVS style):
 *  - length 12..72 bytes (bcrypt only uses the first 72 bytes, so longer
 *    passwords would be silently truncated — rejected instead)
 *  - not a common/predictable password, not built from the account email
 *  - no arbitrary composition rules (they don't improve real strength)
 */
const MIN_LENGTH = 12;
const MAX_BYTES = 72;

// Small blocklist of passwords/fragments attackers try first. Compared
// case-insensitively after stripping digits/symbols from the ends.
const COMMON = [
  'password', 'passw0rd', 'changeme', 'changeme123', 'welcome', 'letmein', 'qwerty', 'qwertyuiop',
  'administrator', 'admin', 'payroll', 'aunpayroll', 'americanuniversity', 'american university of nigeria',
  'iloveyou', 'abc123', 'monkey', 'dragon', 'football', 'secret', 'sunshine', 'princess', 'master',
];

function validatePassword(password, { email = '' } = {}) {
  if (typeof password !== 'string' || !password) return 'Password is required.';
  if (password.length < MIN_LENGTH) return `Password must be at least ${MIN_LENGTH} characters.`;
  if (Buffer.byteLength(password, 'utf8') > MAX_BYTES) return `Password must be at most ${MAX_BYTES} bytes.`;

  const lower = password.toLowerCase();
  if (/^(.)\1+$/.test(password)) return 'Password cannot be a single repeated character.';
  if (/^(0123456789|1234567890|9876543210|abcdefghijkl)/.test(lower)) return 'Password is too predictable.';

  const core = lower.replace(/^[^a-z]+|[^a-z]+$/g, '');
  if (COMMON.includes(core) || COMMON.includes(lower)) return 'Password is too common. Choose something less predictable.';

  const local = String(email).toLowerCase().split('@')[0];
  if (local.length >= 4 && lower.includes(local)) return 'Password must not contain your email name.';
  return null;
}

module.exports = { validatePassword, MIN_LENGTH, MAX_BYTES };
