import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { Spinner, Empty, Badge } from '../components/ui';
import { dateTime } from '../utils/format';

export default function AuditLog() {
  const [logs, setLogs] = useState(null);
  useEffect(() => { api.get('/audit?limit=200').then((d) => setLogs(d.logs)); }, []);
  if (!logs) return <div className="center" style={{ padding: 60 }}><Spinner dark /></div>;

  return (
    <div className="card">
      <div className="card-head"><h3>Audit Log</h3><span className="faint small">Every payroll action is recorded</span></div>
      {logs.length === 0 ? <Empty icon="📋" title="No audit entries yet" /> : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="small" style={{ whiteSpace: 'nowrap' }}>{dateTime(l.created_at)}</td>
                  <td className="small">{l.actor_email || '—'}</td>
                  <td><Badge tone={toneFor(l.action)}>{l.action}</Badge></td>
                  <td className="small">{l.entity ? `${l.entity} #${l.entity_id ?? ''}` : '—'}</td>
                  <td className="small faint">{l.details ? shorten(l.details) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function toneFor(a) {
  if (a.includes('failed') || a.includes('login_failed')) return 'red';
  if (a.includes('send') || a.includes('login')) return 'green';
  if (a.includes('upload') || a.includes('generate')) return 'blue';
  if (a.includes('settings')) return 'amber';
  return 'gray';
}
function shorten(d) {
  try { return Object.entries(d).map(([k, v]) => `${k}: ${v}`).join(', ').slice(0, 90); } catch { return ''; }
}
