export function naira(v) {
  const n = Number(v) || 0;
  return `₦ ${n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function dateTime(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-NG', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function dateOnly(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-NG', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function initials(name) {
  return (name || '?').split(' ').filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join('');
}

const STATUS_STYLE = {
  pending: 'gray', skipped: 'gray', generating: 'blue', generated: 'purple',
  sending: 'amber', sent: 'green', failed: 'red',
  uploaded: 'gray', validated: 'blue', completed: 'green',
};
export function statusBadge(s) {
  return STATUS_STYLE[s] || 'gray';
}
