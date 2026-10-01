/**
 * Nigerian Naira formatting helpers.
 * Format:  ₦ 122,333.33   (always 2 dp, thousands separators)
 */
const NAIRA = '₦'; // ₦

function formatNaira(value) {
  const n = Number(value) || 0;
  return `${NAIRA} ${n.toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

module.exports = { NAIRA, formatNaira };
