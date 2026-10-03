import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { Badge, Spinner, Empty } from '../components/ui';
import { statusBadge, dateTime } from '../utils/format';
import { useAuth } from '../auth/AuthContext';
import { can } from '../utils/permissions';

export default function History() {
  const [runs, setRuns] = useState(null);
  const nav = useNavigate();
  const { user } = useAuth();
  useEffect(() => { api.get('/payroll/runs').then((d) => setRuns(d.runs)); }, []);

  if (!runs) return <div className="center" style={{ padding: 60 }}><Spinner dark /></div>;

  return (
    <div className="card">
      <div className="card-head">
        <h3>Payroll Runs</h3>
        {can(user, 'payroll.upload') && <Link to="/upload" className="btn sm">+ New Payroll Run</Link>}
      </div>
      {runs.length === 0 ? <Empty icon="🗂" title="No payroll runs yet">Upload a payroll file to create your first run.</Empty> : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>Period</th><th>Employees</th><th>Generated</th><th>Sent</th><th>Failed</th><th>Uploaded</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => nav(`/history/${r.id}`)}>
                  <td><b>{r.period}</b></td>
                  <td>{r.total_employees}</td>
                  <td>{r.generated_count}</td>
                  <td>{r.sent_count}</td>
                  <td>{r.failed_count ? <span style={{ color: 'var(--red)', fontWeight: 700 }}>{r.failed_count}</span> : 0}</td>
                  <td className="small">{dateTime(r.created_at)}</td>
                  <td><Badge tone={statusBadge(r.status)}>{r.status}</Badge></td>
                  <td className="num"><span className="btn ghost sm">Open →</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
