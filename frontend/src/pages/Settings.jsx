import { useEffect, useState } from 'react';
import { api, setCsrfToken } from '../services/api';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { Spinner, Badge } from '../components/ui';
import { dateTime } from '../utils/format';

export default function Settings() {
  const { user } = useAuth();
  const toast = useToast();
  // Non-admins only manage their own password.
  if (user?.role !== 'admin') {
    return <div style={{ maxWidth: 780 }}><ChangePassword toast={toast} /></div>;
  }
  return <AdminSettings toast={toast} />;
}

function AdminSettings({ toast }) {
  const [s, setS] = useState(null);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => { api.get('/settings').then(setS); }, []);

  async function verify() {
    setVerifying(true);
    try {
      const r = await api.post('/settings/smtp/verify');
      if (r.ok) toast.success('Email connection OK', r.message);
      else toast.error('Email connection', r.message);
    } catch (e) { toast.error('Check failed', e.message); } finally { setVerifying(false); }
  }

  if (!s) return <div className="center" style={{ padding: 60 }}><Spinner dark /></div>;
  const m = s.smtp;

  return (
    <div style={{ maxWidth: 780 }}>
      {/* Email delivery — read-only: credentials live only on the server */}
      <div className="card card-pad mb">
        <div className="row between">
          <h3>Email Delivery {m.configured ? <Badge tone="green">configured</Badge> : <Badge tone="amber">not configured</Badge>}</h3>
          <button className="btn secondary sm" onClick={verify} disabled={verifying || !m.configured}>{verifying ? <Spinner dark /> : 'Test Connection'}</button>
        </div>
        <p className="faint small mb">
          Email settings and the mailbox password are managed on the server (backend/.env) and are never shown or changed in the browser.
          {!m.configured && <> Until they are completed, pay advices can be generated but not emailed.</>}
        </p>
        <dl className="kv">
          <dt>Sends from</dt><dd>{m.from || '—'}</dd>
          <dt>Mail server</dt><dd>{m.host ? `${m.host}:${m.port} (${m.secure ? 'SSL/TLS' : 'STARTTLS'})` : '—'}</dd>
          <dt>Account</dt><dd>{m.user || '—'}</dd>
          <dt>Password</dt><dd>{m.passwordConfigured ? 'set' : 'not set'}</dd>
          <dt>Replies go to</dt><dd>{m.replyTo || '—'}</dd>
        </dl>
      </div>

      <ChangePassword toast={toast} />

      <UserManagement toast={toast} />
    </div>
  );
}

function ChangePassword({ toast }) {
  const empty = { currentPassword: '', newPassword: '', confirm: '' };
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const mismatch = form.confirm && form.newPassword !== form.confirm;

  async function save() {
    setBusy(true);
    try {
      const r = await api.post('/auth/change-password', { currentPassword: form.currentPassword, newPassword: form.newPassword });
      setCsrfToken(r.csrfToken); // this browser gets a fresh session; others are signed out
      setForm(empty);
      toast.success('Password changed', 'Other devices have been signed out.');
    } catch (e) { toast.error('Could not change password', e.message); } finally { setBusy(false); }
  }

  return (
    <div className="card card-pad mb">
      <h3>Change Password</h3>
      <p className="faint small mb">At least 12 characters. Avoid common words and your email name — a long passphrase works well.</p>
      <div className="grid cols-2">
        <div className="field"><label>Current password</label>
          <input className="input" type="password" autoComplete="current-password" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} /></div>
        <div />
        <div className="field"><label>New password</label>
          <input className="input" type="password" autoComplete="new-password" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} /></div>
        <div className="field"><label>Confirm new password {mismatch && <span style={{ color: 'var(--red)' }}>— does not match</span>}</label>
          <input className="input" type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} /></div>
      </div>
      <button className="btn" onClick={save} disabled={busy || !form.currentPassword || form.newPassword.length < 12 || mismatch}>
        {busy ? <Spinner /> : 'Change Password'}
      </button>
    </div>
  );
}

function UserManagement({ toast }) {
  const [users, setUsers] = useState(null);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'payroll_officer' });
  const [busy, setBusy] = useState(false);

  const load = () => api.get('/users').then((d) => setUsers(d.users)).catch(() => setUsers([]));
  useEffect(() => { load(); }, []);

  async function create() {
    setBusy(true);
    try {
      await api.post('/users', form);
      toast.success('User created');
      setForm({ name: '', email: '', password: '', role: 'payroll_officer' });
      load();
    } catch (e) { toast.error('Could not create user', e.message); } finally { setBusy(false); }
  }

  return (
    <div className="card">
      <div className="card-head"><h3>Payroll Users</h3></div>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Last login</th></tr></thead>
          <tbody>
            {(users || []).map((u) => (
              <tr key={u.id}><td><b>{u.name}</b></td><td>{u.email}</td><td><Badge tone="purple">{u.role}</Badge></td><td className="small faint">{dateTime(u.last_login_at)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card-pad" style={{ borderTop: '1px solid var(--line)' }}>
        <h4 className="mb" style={{ fontSize: 13 }}>Add a user</h4>
        <div className="grid cols-2">
          <div className="field"><label>Name</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="field"><label>Email</label><input className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div className="field"><label>Temporary password <span className="faint">(min 12 characters)</span></label><input className="input" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
          <div className="field"><label>Role</label>
            <select className="select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="payroll_officer">Payroll Officer</option>
              <option value="admin">Administrator</option>
              <option value="viewer">Viewer (read-only)</option>
            </select>
          </div>
        </div>
        <button className="btn" onClick={create} disabled={busy || !form.name || !form.email || !form.password}>{busy ? <Spinner /> : 'Create User'}</button>
      </div>
    </div>
  );
}
