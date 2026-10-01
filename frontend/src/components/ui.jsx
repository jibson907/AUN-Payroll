// Small shared presentational components.
export function Badge({ tone = 'gray', children }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function Stat({ label, value, sub, icon, tone = 'purple' }) {
  const bg = {
    purple: '#ece9f7', green: '#e6f5e6', red: '#fdeae8', amber: '#fbf1dd', blue: '#e7effc',
  }[tone];
  const fg = {
    purple: '#4b3aa0', green: '#2e8a2a', red: '#d23b2f', amber: '#a9781a', blue: '#2456b0',
  }[tone];
  return (
    <div className="card stat">
      {icon && <div className="icon" style={{ background: bg, color: fg }}>{icon}</div>}
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

export function Spinner({ dark }) {
  return <span className={`spinner ${dark ? 'dark' : ''}`} />;
}

export function Empty({ icon = '📭', title, children }) {
  return (
    <div className="empty">
      <div className="big">{icon}</div>
      <h3 style={{ color: 'var(--muted)' }}>{title}</h3>
      {children && <p className="small">{children}</p>}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, size }) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${size || ''}`}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="x-btn" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function ProgressBar({ value, max }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return <div className="progress"><div style={{ width: `${pct}%` }} /></div>;
}
