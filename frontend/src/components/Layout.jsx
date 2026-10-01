import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { initials } from '../utils/format';
import logo from '../assets/aun-logo.png';

const NAV = [
  { to: '/', label: 'Dashboard', icon: '▤', end: true },
  { to: '/upload', label: 'Upload Payroll', icon: '⬆' },
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
  const { user, logout } = useAuth();
  const loc = useLocation();
  const [open, setOpen] = useState(false);

  const title = TITLES[loc.pathname] || (loc.pathname.startsWith('/history') ? 'Payroll Run' : 'AUN Payroll');
  const canAdmin = user?.role === 'admin';

  return (
    <div className="app-shell">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <img src={logo} alt="AUN" />
          <div><b>AUN Payroll</b><span>Pay Advice System</span></div>
        </div>
        <nav className="nav">
          {NAV.map((n) => (
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
        <div className="foot">Signed in as<br /><b style={{ color: '#fff' }}>{user?.name}</b><br />{user?.role}</div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="row">
            <button className="btn ghost" style={{ display: 'none' }} onClick={() => setOpen((o) => !o)}>☰</button>
            <div className="page-title">{title}</div>
          </div>
          <div className="user">
            <div className="avatar">{initials(user?.name)}</div>
            <button className="btn secondary sm" onClick={logout}>Sign out</button>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
