import { useCallback, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { initials } from '../utils/format';
import logo from '../assets/aun-logo.png';
import { can, ROLE_LABELS } from '../utils/permissions';
import { useIdleLogout } from '../hooks/useIdleLogout';
import { Modal } from './ui';

const NAV = [
  { to: '/', label: 'Dashboard', icon: '▤', end: true },
  { to: '/upload', label: 'Upload Payroll', icon: '⬆', perm: 'payroll.upload' },
  { to: '/history', label: 'Payroll History', icon: '🗂' },
  { to: '/employees', label: 'Employee Search', icon: '🔍' },
  { to: '/audit', label: 'Audit Log', icon: '📋' },
];
const ADMIN_NAV = [
  { to: '/settings', label: 'Settings', icon: '⚙' },
];

const TITLES = {
  '/': 'Dashboard', '/upload': 'Upload Payroll', '/history': 'Payroll History',
  '/employees': 'Employee Search', '/audit': 'Audit Log', '/settings': 'Settings',
};

export default function Layout({ children }) {
  const { user, logout, idleMinutes } = useAuth();
  // security: sign out automatically after a period without activity
  const onIdle = useCallback(() => logout('idle'), [logout]);
  const { secondsLeft, stayActive } = useIdleLogout({ minutes: idleMinutes, onTimeout: onIdle, enabled: !!user });
  const loc = useLocation();
  const [open, setOpen] = useState(false);

  const title = TITLES[loc.pathname] || (loc.pathname.startsWith('/history') ? 'Payroll Run' : 'AUN Payroll');
  const canAdmin = can(user, 'users.manage');

  return (
    <div className="app-shell">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <img src={logo} alt="AUN" />
          <div><b>AUN Payroll</b><span>Pay Advice System</span></div>
        </div>
        <nav className="nav">
          {NAV.filter((n) => !n.perm || can(user, n.perm)).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} onClick={() => setOpen(false)}>
              <span className="ic">{n.icon}</span>{n.label}
            </NavLink>
          ))}
          <div className="group-label">{canAdmin ? 'Administration' : 'Account'}</div>
          {ADMIN_NAV.map((n) => (
            <NavLink key={n.to} to={n.to} onClick={() => setOpen(false)}>
              <span className="ic">{n.icon}</span>{n.label}
            </NavLink>
          ))}
        </nav>
        <div className="foot">Signed in as<br /><b style={{ color: '#fff' }}>{user?.name}</b><br />{ROLE_LABELS[user?.role] || user?.role}</div>
      </aside>
      {open && <div className="sidebar-backdrop" onClick={() => setOpen(false)} />}

      <div className="main">
        <header className="topbar">
          <div className="row">
            <button className="btn ghost menu-btn" aria-label="Open menu" onClick={() => setOpen((o) => !o)}>☰</button>
            <div className="page-title">{title}</div>
          </div>
          <div className="user">
            <div className="avatar">{initials(user?.name)}</div>
            <button className="btn secondary sm" onClick={() => logout()}>Sign out</button>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>

      {secondsLeft !== null && (
        <Modal title="Are you still there?" onClose={stayActive}
          footer={(
            <>
              <button className="btn secondary" onClick={() => logout()}>Sign out</button>
              <button className="btn" onClick={stayActive}>Stay signed in</button>
            </>
          )}
        >
          <p style={{ margin: 0 }}>
            For security, you will be signed out in <b>{secondsLeft} second{secondsLeft === 1 ? '' : 's'}</b> because there has been no activity for a while.
          </p>
        </Modal>
      )}
    </div>
  );
}
