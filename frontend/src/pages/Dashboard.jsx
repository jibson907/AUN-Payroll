import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { Stat, Spinner, Badge, Empty } from '../components/ui';
import { dateTime, statusBadge } from '../utils/format';

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [emailReady, setEmailReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const nav = useNavigate();

  useEffect(() => {
    api.get('/dashboard').then(setData).catch(() => {}).finally(() => setLoading(false));
    api.get('/settings').then((s) => setEmailReady(!!s.smtp.configured)).catch(() => {});
  }, []);

  if (loading) return <div className="center" style={{ padding: 60 }}><Spinner dark /></div>;
  if (!data) return <Empty title="Could not load dashboard" />;

  const a = data.agg;
  return (
    <>
      {!emailReady && (
        <div className="alert warn mb">
          <b>Email sending is not configured yet.</b> Payroll files can be uploaded and pay advices generated,
          but nothing can be emailed until the server&apos;s email settings are completed.
        </div>
      )}
      <div className="grid cols-4 mb">
        <Stat label="Total Employees" value={a.totalEmployees} sub={`${a.totalRuns} payroll run(s)`} icon="👥" tone="purple" />
        <Stat label="Pay Advices Generated" value={a.generated} icon="📄" tone="blue" />
        <Stat label="Emails Sent" value={a.sent} icon="✉" tone="green" />
        <Stat label="Emails Failed" value={a.failed} sub={`${a.pending} pending · ${a.skipped || 0} skipped`} icon="⚠" tone={a.failed ? 'red' : 'amber'} />
      </div>

      <div className="grid cols-2">
        <div className="card">
          <div className="card-head">
            <h3>Recent Payroll Runs</h3>
            <Link to="/history" className="btn ghost sm">View all →</Link>
          </div>
          {data.recentRuns.length === 0 ? (
            <Empty icon="🗂" title="No payroll runs yet">Upload a payroll file to get started.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Period</th><th>Employees</th><th>Generated</th><th>Sent</th><th>Failed</th><th>Status</th></tr></thead>
                <tbody>
                  {data.recentRuns.map((r) => (
                    <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => nav(`/history/${r.id}`)}>
                      <td><b>{r.period}</b></td>
                      <td>{r.total_employees}</td>
                      <td>{r.generated_count}</td>
                      <td>{r.sent_count}</td>
                      <td>{r.failed_count}</td>
                      <td><Badge tone={statusBadge(r.status)}>{r.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-head"><h3>Recent Activity</h3><Link to="/audit" className="btn ghost sm">Audit log →</Link></div>
          <div className="card-pad">
            {data.recentActivity.length === 0 ? <p className="faint small">No activity recorded yet.</p> : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {data.recentActivity.map((l) => (
                  <li key={l.id} className="row" style={{ padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
                    <div className="avatar" style={{ width: 28, height: 28, fontSize: 11, background: '#ece9f7', color: '#4b3aa0' }}>
                      {(l.actor_email || '?')[0].toUpperCase()}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div className="small"><b>{prettyAction(l.action)}</b></div>
                      <div className="faint" style={{ fontSize: 11.5 }}>{l.actor_email || 'system'} · {dateTime(l.created_at)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function prettyAction(a) {
  const map = {
    'payroll.upload': 'Uploaded payroll file',
    'payroll.generate.start': 'Started generating pay advices',
    'payroll.generate.complete': 'Finished generating pay advices',
    'payroll.send.start': 'Started sending pay advices',
    'payroll.send.complete': 'Finished sending pay advices',
    'payroll.retry_failed': 'Retried failed emails',
    'payroll.resend_one': 'Resent a pay advice',
    'payroll.download_advice': 'Downloaded a pay advice',
    'auth.login': 'Signed in',
    'settings.smtp_updated': 'Updated SMTP settings',
    'payroll.replaced': 'Replaced an unsent payroll upload',
    'auth.logout': 'Signed out',
    'auth.logout_idle': 'Signed out automatically (inactivity)',
    'auth.password_changed': 'Changed password',
    'payroll.record_edited': 'Edited a payroll record',
    'payroll.record_deleted': 'Deleted a payroll record',
    'payroll.run_deleted': 'Deleted a payroll run',
    'payroll.send.paused': 'Sending paused — email account problem',
    'user.created': 'Added a user',
    'user.updated': 'Updated a user',
    'user.role_changed': 'Changed a user role',
    'user.password_reset': 'Reset a user password',
    'user.deleted': 'Deleted a user',
  };
  return map[a] || a;
}
