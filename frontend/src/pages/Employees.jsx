import { useEffect, useState, useCallback } from 'react';
import { api } from '../services/api';
import { useAuth } from '../auth/AuthContext';
import { Spinner, Empty, Badge } from '../components/ui';
import EmployeeDrawer from '../components/EmployeeDrawer';
import { naira, statusBadge } from '../utils/format';

export default function Employees() {
  const { user } = useAuth();
  const canProcess = ['admin', 'payroll_officer'].includes(user?.role);
  const [runs, setRuns] = useState([]);
  const [runId, setRunId] = useState('');
  const [search, setSearch] = useState('');
  const [emps, setEmps] = useState(null);
  const [openEmp, setOpenEmp] = useState(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    api.get('/payroll/runs').then((d) => {
      setRuns(d.runs);
      if (d.runs[0]) setRunId(String(d.runs[0].id));
    });
  }, []);

  const load = useCallback(async () => {
    if (!runId) { setEmps({ rows: [], total: 0 }); return; }
    const d = await api.get(`/payroll/runs/${runId}/employees?search=${encodeURIComponent(search)}&page=${page}&pageSize=25`);
    setEmps(d);
  }, [runId, search, page]);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <div className="card mb">
        <div className="card-head">
          <div className="row" style={{ gap: 10 }}>
            <select className="select" style={{ width: 200 }} value={runId} onChange={(e) => { setPage(1); setRunId(e.target.value); }}>
              {runs.length === 0 && <option>No payroll runs</option>}
              {runs.map((r) => <option key={r.id} value={r.id}>{r.period}</option>)}
            </select>
            <input className="input" style={{ width: 300 }} placeholder="Search by name, employee ID, department or email…"
              value={search} onChange={(e) => { setPage(1); setSearch(e.target.value); }} />
          </div>
          <span className="faint small">{emps?.total ?? 0} results</span>
        </div>

        {!emps ? <div className="center" style={{ padding: 40 }}><Spinner dark /></div>
          : emps.rows.length === 0 ? <Empty icon="🔍" title="No employees found">Try a different search or payroll period.</Empty>
            : (
              <div className="table-wrap">
                <table className="data">
                  <thead><tr><th>Employee</th><th>ID</th><th>Department</th><th>Email</th><th className="num">Net Pay</th><th>Status</th><th></th></tr></thead>
                  <tbody>
                    {emps.rows.map((e) => (
                      <tr key={e.id} style={{ cursor: 'pointer' }} onClick={() => setOpenEmp(e.id)}>
                        <td><b>{e.name}</b><div className="faint" style={{ fontSize: 11.5 }}>{e.designation}</div></td>
                        <td className="mono">{e.employee_id}</td>
                        <td className="small">{e.department}</td>
                        <td className="small faint">{e.email}</td>
                        <td className="num"><b>{naira(e.net_pay)}</b></td>
                        <td><Badge tone={statusBadge(e.valid ? e.email_status : 'failed')}>{e.valid ? e.email_status : 'invalid'}</Badge></td>
                        <td className="num"><span className="btn ghost sm">View →</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        {emps && emps.total > emps.pageSize && (
          <div className="row between card-pad" style={{ borderTop: '1px solid var(--line)' }}>
            <span className="faint small">Page {emps.page} of {Math.ceil(emps.total / emps.pageSize)}</span>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn secondary sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Prev</button>
              <button className="btn secondary sm" disabled={page >= Math.ceil(emps.total / emps.pageSize)} onClick={() => setPage((p) => p + 1)}>Next →</button>
            </div>
          </div>
        )}
      </div>

      {openEmp && <EmployeeDrawer empId={openEmp} canProcess={canProcess} onClose={() => setOpenEmp(null)} onChanged={load} />}
    </>
  );
}
