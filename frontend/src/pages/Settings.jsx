import { useEffect, useState } from 'react';
import { api, setCsrfToken } from '../services/api';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { Spinner, Badge, Modal } from '../components/ui';
import { dateTime } from '../utils/format';
import { can, MIN_PASSWORD, ROLE_LABELS } from '../utils/permissions';

export default function Settings() {
  const { user } = useAuth();
  const toast = useToast();
  // Non-admins only manage their own password.
  if (!can(user, 'users.manage')) {
    return <div style={{ maxWidth: 780 }}><ChangePassword toast={toast} /></div>;
  }
  return <AdminSettings toast={toast} me={user} />;
}

function AdminSettings({ toast, me }) {
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
    <div>
      {/* full page width: email + password side by side, users table below */}
      <div className="grid cols-2" style={{ alignItems: 'start' }}>
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
      </div>

      <UserManagement toast={toast} me={me} />
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
      <p className="faint small mb">At least 6 characters. Avoid common words, simple sequences like 123456 and your email name.</p>
      <div className="grid cols-2">
        <div className="field"><label>Current password</label>
          <input className="input" type="password" autoComplete="current-password" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} /></div>
        <div />
        <div className="field"><label>New password</label>
          <input className="input" type="password" autoComplete="new-password" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} /></div>
        <div className="field"><label>Confirm new password {mismatch && <span style={{ color: 'var(--red)' }}>— does not match</span>}</label>
          <input className="input" type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} /></div>
      </div>
      <button className="btn" onClick={save} disabled={busy || !form.currentPassword || form.newPassword.length < MIN_PASSWORD || mismatch}>
        {busy ? <Spinner /> : 'Change Password'}
      </button>
    </div>
  );
}

function UserManagement({ toast, me }) {
  const [users, setUsers] = useState(null);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'payroll_officer' });
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null); // user being edited
  const [resetting, setResetting] = useState(null); // user whose password is being reset

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

  async function remove(u) {
    if (!window.confirm(`Delete the account of ${u.name} (${u.email})? They will no longer be able to sign in. This cannot be undone.`)) return;
    try {
      await api.del(`/users/${u.id}`);
      toast.success('User deleted', `${u.name} can no longer sign in.`);
      load();
    } catch (e) { toast.error('Could not delete user', e.message); }
  }

  return (
    <div className="card">
      <div className="card-head"><h3>Payroll Users</h3></div>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Last login</th><th></th></tr></thead>
          <tbody>
            {(users || []).map((u) => (
              <tr key={u.id}>
                <td><b>{u.name}</b>{u.id === me?.id && <span className="faint small"> (you)</span>}</td>
                <td>{u.email}</td>
                <td><Badge tone="purple">{ROLE_LABELS[u.role] || u.role}</Badge>{!u.active && <> <Badge tone="gray">inactive</Badge></>}</td>
                <td className="small faint">{dateTime(u.last_login_at)}</td>
                <td className="num" style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn ghost sm" onClick={() => setEditing(u)}>Edit</button>
                  {u.id !== me?.id && (
                    <>
                      <button className="btn ghost sm" onClick={() => setResetting(u)}>Reset password</button>
                      <button className="btn ghost sm" style={{ color: 'var(--red)' }} onClick={() => remove(u)}>Delete</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <EditUser u={editing} self={editing.id === me?.id} toast={toast} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {resetting && <ResetPassword u={resetting} toast={toast} onClose={() => setResetting(null)} />}
      <div className="card-pad" style={{ borderTop: '1px solid var(--line)' }}>
        <h4 className="mb" style={{ fontSize: 13 }}>Add a user</h4>
        <div className="grid cols-4">
          <div className="field"><label>Name</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="field"><label>Email</label><input className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div className="field"><label>Temporary password <span className="faint">(min {MIN_PASSWORD} characters)</span></label><input className="input" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
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

// Edit another user's name, email, role or access (admin only — enforced by the API).
function EditUser({ u, self, toast, onClose, onSaved }) {
  const [form, setForm] = useState({ name: u.name, email: u.email, role: u.role, active: u.active });
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      // own account: only name/email (role and access are changed by another admin)
      const body = self ? { name: form.name, email: form.email } : form;
      await api.put(`/users/${u.id}`, body);
      toast.success('User updated', (!self && (form.role !== u.role || form.active !== u.active)) ? `${form.name} has been signed out so the change takes effect.` : undefined);
      onSaved();
    } catch (e) { toast.error('Could not update user', e.message); } finally { setBusy(false); }
  }

  return (
    <Modal title={`Edit user — ${u.name}`} onClose={onClose}
      footer={(
        <>
          <button className="btn secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn" onClick={save} disabled={busy || !form.name || !form.email}>{busy ? <Spinner /> : 'Save Changes'}</button>
        </>
      )}
    >
      <div className="grid cols-2">
        <div className="field"><label>Name</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div className="field"><label>Email</label><input className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
        <div className="field"><label>Role</label>
          <select className="select" value={form.role} disabled={self} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="payroll_officer">Payroll Officer</option>
            <option value="admin">Administrator</option>
            <option value="viewer">Viewer (read-only)</option>
          </select>
        </div>
        <div className="field"><label>Access</label>
          <select className="select" value={form.active ? 'active' : 'inactive'} disabled={self} onChange={(e) => setForm({ ...form, active: e.target.value === 'active' })}>
            <option value="active">Active — can sign in</option>
            <option value="inactive">Inactive — cannot sign in</option>
          </select>
        </div>
      </div>
      {self && <p className="faint small" style={{ margin: 0 }}>You cannot change your own role or access. Ask another administrator.</p>}
    </Modal>
  );
}

// Set a temporary password for another user (admin only — enforced by the API).
function ResetPassword({ u, toast, onClose }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api.post(`/users/${u.id}/reset-password`, { password });
      toast.success('Password reset', `Give ${u.name} the temporary password and ask them to change it after signing in. They have been signed out everywhere.`);
      onClose();
    } catch (e) { toast.error('Could not reset password', e.message); } finally { setBusy(false); }
  }

  return (
    <Modal title={`Reset password — ${u.name}`} onClose={onClose}
      footer={(
        <>
          <button className="btn secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn" onClick={save} disabled={busy || password.length < MIN_PASSWORD}>{busy ? <Spinner /> : 'Reset Password'}</button>
        </>
      )}
    >
      <div className="field"><label>New temporary password <span className="faint">(min {MIN_PASSWORD} characters)</span></label>
        <input className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
      <p className="faint small" style={{ margin: 0 }}>This also unlocks the account if it was locked after failed sign-ins.</p>
    </Modal>
  );
}
