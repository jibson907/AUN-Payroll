import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { usePolling } from '../hooks/usePolling';
import { Badge, Spinner, Empty, ProgressBar, Modal } from '../components/ui';
import EmployeeDrawer from '../components/EmployeeDrawer';
import { naira, statusBadge, dateTime } from '../utils/format';

const FILTERS = [
  { k: '', label: 'All' }, { k: 'valid', label: 'Valid' }, { k: 'invalid', label: 'Errors' },
  { k: 'sent', label: 'Sent' }, { k: 'failed', label: 'Failed' }, { k: 'pending', label: 'Pending' }, { k: 'skipped', label: 'Skipped' },
];

export default function RunDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const canProcess = ['admin', 'payroll_officer'].includes(user?.role);

  const [active, setActive] = useState(false);
  const [runData] = usePolling(() => api.get(`/payroll/runs/${id}`), { active, interval: 2000 });
  const run = runData?.run;
  const counts = runData?.counts;

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  const [emps, setEmps] = useState(null);
  const [openEmp, setOpenEmp] = useState(null);
  const [acting, setActing] = useState(false);
  const [confirm, setConfirm] = useState(null); // { path, label, title, body }

  useEffect(() => { if (run) setActive(run.jobActive); }, [run?.jobActive]);

  const loadEmps = useCallback(async () => {
    const d = await api.get(`/payroll/runs/${id}/employees?search=${encodeURIComponent(search)}&status=${filter}&page=${page}&pageSize=25`);
    setEmps(d);
  }, [id, search, filter, page]);

  useEffect(() => { loadEmps(); }, [loadEmps]);
  // refresh table when a job is active
  useEffect(() => { if (active) { const t = setInterval(loadEmps, 2500); return () => clearInterval(t); } }, [active, loadEmps]);

  async function act(path, label) {
    setActing(true);
    try {
      await api.post(`/payroll/runs/${id}/${path}`);
      toast.info(label, 'Processing has started — progress updates live below.');
      setActive(true);
    } catch (e) {
      toast.error('Action failed', e.message);
    } finally {
      setActing(false);
    }
  }

  if (!run) return <div className="center" style={{ padding: 60 }}><Spinner dark /></div>;

  const vs = run.validation_summary || {};
  const canGenerate = canProcess && ['validated', 'generated', 'completed'].includes(run.status) && !run.jobActive;
  const canSend = canProcess && ['generated', 'completed', 'sending'].includes(run.status) && !run.jobActive && vs.valid > 0;
  const hasFailed = (counts?.failed || 0) > 0;

  return (
    <>
      {/* header */}
      <div className="card card-pad mb">
        <div className="row between wrap">
          <div>
            <div className="row" style={{ gap: 10 }}>
              <h2 style={{ fontSize: 22 }}>{run.period}</h2>
              <Badge tone={statusBadge(run.status)}>{run.status}</Badge>
            </div>
            <p className="faint small mt-sm">
              {run.original_filename} · uploaded {dateTime(run.created_at)}
            </p>
          </div>
          <div className="row wrap" style={{ gap: 10 }}>
            <button className="btn secondary" disabled={!canGenerate || acting} onClick={() => act('generate', 'Generating pay advices')}>
              📄 Generate PDFs
            </button>
            <button className="btn green" disabled={!canSend || acting} onClick={() => setConfirm({ path: 'send', label: 'Sending pay advices', title: 'Send pay advices?', body: `Each of the ${(counts?.pending || 0) + (counts?.generated || 0) + (counts?.failed || 0)} employee(s) not yet emailed will receive THEIR OWN pay advice for ${run.period} at the email address in the uploaded file. Emails go out in controlled batches. Records with errors are skipped. This cannot be undone.` })}>
              ✉ Send Pay Advices
            </button>
            {hasFailed && (
              <button className="btn danger" disabled={!canProcess || run.jobActive || acting} onClick={() => setConfirm({ path: 'retry-failed', label: 'Retrying failed emails', title: 'Retry failed emails?', body: `${counts.failed} failed email(s) will be sent again. Check the failure reasons first — an email interrupted by a server restart may already have been delivered.` })}>
                ↻ Retry Failed ({counts.failed})
              </button>
            )}
          </div>
        </div>
      </div>

      {/* validation summary */}
      <div className="grid cols-4 mb">
        <MiniStat label="Total Employees" value={vs.total ?? run.total_employees} tone="purple" />
        <MiniStat label="Valid Records" value={vs.valid ?? run.valid_count} tone="green" />
        <MiniStat label="Records with Errors" value={vs.invalid ?? run.invalid_count} tone={vs.invalid ? 'red' : 'gray'} />
        <MiniStat label="Emails Sent" value={counts?.sent ?? run.sent_count ?? 0} tone="blue" />
      </div>

      {vs.invalid > 0 && (
        <div className="alert warn mb">
          <b>Validation found {vs.invalid} record(s) with issues.</b>{' '}
          These are excluded from generation & sending until corrected. You can fix the Excel file and re-upload.
          <div className="row wrap mt-sm" style={{ gap: 14, marginTop: 8 }}>
            <IssueTag n={vs.missingEmail} label="missing email" />
            <IssueTag n={vs.invalidEmail} label="invalid email" />
            <IssueTag n={vs.missingId} label="missing ID" />
            <IssueTag n={vs.missingName} label="missing name" />
            <IssueTag n={vs.invalidNumeric} label="invalid numbers" />
            <IssueTag n={vs.duplicateId} label="duplicate ID" />
            <IssueTag n={vs.duplicateEmail} label="duplicate email" />
          </div>
        </div>
      )}

      {/* progress dashboard */}
      {counts && ['generating', 'generated', 'sending', 'completed'].includes(run.status) && (
        <div className="card card-pad mb">
          <div className="row between mb">
            <h3>Delivery Status {run.jobActive && <span className="faint small">· live</span>}</h3>
            <span className="faint small">{run.jobActive ? <><Spinner dark /> processing…</> : 'idle'}</span>
          </div>
          <ProgressBar value={(counts.sent || 0)} max={vs.valid || run.valid_count || 1} />
          <div className="row wrap mt" style={{ gap: 22 }}>
            <Chip tone="gray" label="Pending" n={counts.pending || 0} />
            <Chip tone="blue" label="Generating" n={counts.generating || 0} />
            <Chip tone="purple" label="Generated" n={counts.generated || 0} />
            <Chip tone="amber" label="Sending" n={counts.sending || 0} />
            <Chip tone="green" label="Sent" n={counts.sent || 0} />
            <Chip tone="red" label="Failed" n={counts.failed || 0} />
            <Chip tone="gray" label="Skipped" n={counts.skipped || 0} />
          </div>
        </div>
      )}

      {/* employee table */}
      <div className="card">
        <div className="card-head">
          <div className="row" style={{ gap: 10 }}>
            <input className="input" style={{ width: 230 }} placeholder="Search name, ID, dept, email…"
              value={search} onChange={(e) => { setPage(1); setSearch(e.target.value); }} />
            <div className="row" style={{ gap: 4 }}>
              {FILTERS.map((f) => (
                <button key={f.k} className={`btn sm ${filter === f.k ? '' : 'secondary'}`} onClick={() => { setPage(1); setFilter(f.k); }}>{f.label}</button>
              ))}
            </div>
          </div>
          <span className="faint small">{emps?.total ?? 0} records</span>
        </div>

        {!emps ? <div className="center" style={{ padding: 40 }}><Spinner dark /></div>
          : emps.rows.length === 0 ? <Empty icon="🔍" title="No matching employees" />
            : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Employee</th><th>ID</th><th>Department</th>
                      <th className="num">Gross Pay</th><th className="num">Deductions</th><th className="num">Net Pay</th>
                      <th>Email Status</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {emps.rows.map((e) => (
                      <tr key={e.id} style={{ cursor: 'pointer' }} onClick={() => setOpenEmp(e.id)}>
                        <td>
                          <b>{e.name || '—'}</b>
                          {!e.valid && <Badge tone="red">error</Badge>}
                          <div className="faint" style={{ fontSize: 11.5 }}>{e.designation}</div>
                        </td>
                        <td className="mono">{e.employee_id || '—'}</td>
                        <td className="small">{e.department || '—'}</td>
                        <td className="num">{naira(e.gross_pay)}</td>
                        <td className="num">{naira(e.total_deductions)}</td>
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

      {confirm && (
        <Modal title={confirm.title} onClose={() => setConfirm(null)}
          footer={(
            <>
              <button className="btn secondary" onClick={() => setConfirm(null)}>Cancel</button>
              <button className="btn green" disabled={acting} onClick={() => { const c = confirm; setConfirm(null); act(c.path, c.label); }}>Yes, send</button>
            </>
          )}
        >
          <p style={{ margin: 0 }}>{confirm.body}</p>
        </Modal>
      )}

      {openEmp && (
        <EmployeeDrawer empId={openEmp} canProcess={canProcess} onClose={() => setOpenEmp(null)} onChanged={loadEmps} />
      )}
    </>
  );
}

function MiniStat({ label, value, tone }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className="value" style={{ fontSize: 24 }}>{value}</div>
    </div>
  );
}
function IssueTag({ n, label }) {
  if (!n) return null;
  return <span className="badge red">{n} {label}</span>;
}
function Chip({ tone, label, n }) {
  return (
    <div className="row" style={{ gap: 8 }}>
      <span className={`badge ${tone}`}>{n}</span>
      <span className="small faint">{label}</span>
    </div>
  );
}
