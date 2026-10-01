import { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Spinner } from '../components/ui';
import logo from '../assets/aun-logo.png';

export default function Login() {
  const { login, user } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function submit(e) {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      await login(email.trim(), password);
      nav('/', { replace: true });
    } catch (e2) {
      setErr(e2.message || 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-hero">
        <img src={logo} alt="AUN" />
        <h1>American University<br />of Nigeria</h1>
        <p>Payroll Pay-Advice System — securely import payroll, generate individual pay advices, and deliver each employee their own confidential payslip.</p>
      </div>
      <div className="login-form-col">
        <form className="login-card" onSubmit={submit}>
          <h2>Payroll Sign-in</h2>
          <p className="sub">Authorised payroll staff only.</p>
          {err && <div className="alert error">{err}</div>}
          <div className="field">
            <label>Email address</label>
            <input className="input" type="email" autoComplete="username" value={email}
              onChange={(e) => setEmail(e.target.value)} placeholder="name@aun.edu.ng" required />
          </div>
          <div className="field">
            <label>Password</label>
            <input className="input" type="password" autoComplete="current-password" value={password}
              onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required />
          </div>
          <button className="btn" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>
            {busy ? <Spinner /> : 'Sign in'}
          </button>
          <p className="help center mt">This system handles confidential payroll data. Sessions expire automatically.</p>
        </form>
      </div>
    </div>
  );
}
