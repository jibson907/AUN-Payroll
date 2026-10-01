import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { Modal, Badge, Spinner } from './ui';
import { useToast } from './Toast';
import { naira, statusBadge, dateTime } from '../utils/format';

// Employee detail + PDF preview + resend.
export default function EmployeeDrawer({ empId, canProcess, onClose, onChanged }) {
  const toast = useToast();
  const [emp, setEmp] = useState(null);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [resending, setResending] = useState(false);

  useEffect(() => {
    let revoke;
    api.get(`/payroll/employees/${empId}`).then(({ employee }) => setEmp(employee));
    // fetch pdf as blob (auth header needed)
    api.getRaw(`/payroll/employees/${empId}/pdf`)
      .then((r) => r.blob())
      .then((b) => { const u = URL.createObjectURL(b); revoke = u; setPdfUrl(u); })
      .catch(() => setPdfUrl('error'));
    return () => { if (revoke) URL.revokeObjectURL(revoke); };
  }, [empId]);

  function askResend() {
    // an employee who already received their pay advice gets it again only on explicit confirmation
    if (emp.email_status === 'sent' && !window.confirm(`${emp.name} has already been sent this pay advice. Send it again to ${emp.email}?`)) return;
    resend();
  }

  async function resend() {
    setResending(true);
    try {
      await api.post(`/payroll/employees/${empId}/resend`);
      toast.success('Pay advice sent', `${emp.name} has been emailed their own pay advice.`);
      const { employee } = await api.get(`/payroll/employees/${empId}`);
      setEmp(employee);
      onChanged && onChanged();
    } catch (e) {
      toast.error('Send failed', e.message);
    } finally {
      setResending(false);
    }
  }

  function download() {
    // open blob in new tab
    if (pdfUrl && pdfUrl !== 'error') window.open(pdfUrl, '_blank');
  }

  const a = emp?.advice;
  return (
    <Modal size="lg" title={emp ? emp.name : 'Loading…'} onClose={onClose}
      footer={(
        <>
          <button className="btn secondary" onClick={download} disabled={!pdfUrl || pdfUrl === 'error'}>⬇ Download PDF</button>
          {canProcess && emp?.valid && (
            <button className="btn green" onClick={askResend} disabled={resending}>
              {resending ? <><Spinner /> Sending…</> : (emp.email_status === 'sent' ? 'Resend Pay Advice' : 'Send Pay Advice')}
            </button>
          )}
        </>
      )}
    >
      {!emp ? <div className="center" style={{ padding: 30 }}><Spinner dark /></div> : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div>
            <dl className="kv">
              <dt>Employee ID</dt><dd>{a.employee.employeeId}</dd>
              <dt>Department</dt><dd>{a.employee.department}</dd>
              <dt>Designation</dt><dd>{a.employee.designation}</dd>
              <dt>Bank</dt><dd>{a.employee.bank}</dd>
              <dt>Account No.</dt><dd>{a.employee.accountNo}</dd>
              <dt>Email (internal)</dt><dd style={{ color: 'var(--muted)' }}>{emp.email}</dd>
              <dt>Email status</dt><dd><Badge tone={statusBadge(emp.email_status)}>{emp.email_status}</Badge></dd>
              <dt>Last sent</dt><dd>{dateTime(emp.sent_at)}</dd>
              <dt>Attempts</dt><dd>{emp.attempt_count || 0}{emp.last_attempt_at ? ` · last ${dateTime(emp.last_attempt_at)}` : ''}</dd>
            </dl>

            {emp.issues?.length > 0 && (
              <div className="alert warn mt-sm" style={{ marginTop: 14 }}>
                <b>Validation notes</b>
                <ul style={{ margin: '6px 0 0 16px', padding: 0 }}>{emp.issues.map((i, k) => <li key={k}>{i}</li>)}</ul>
              </div>
            )}
            {emp.email_error && <div className="alert error" style={{ marginTop: 12 }}>Last error: {emp.email_error}</div>}

            <div className="card mt" style={{ marginTop: 16 }}>
              <div className="card-head" style={{ padding: '12px 16px' }}><h3 style={{ fontSize: 13 }}>Earnings</h3></div>
              <div style={{ padding: '4px 16px 10px' }}>
                {a.earnings.map((e, k) => <Row key={k} l={e.label} v={e.amount} />)}
                <Row l={<b>Gross Earnings</b>} v={a.totals.grossEarnings} strong />
              </div>
            </div>
            <div className="card mt" style={{ marginTop: 12 }}>
              <div className="card-head" style={{ padding: '12px 16px' }}><h3 style={{ fontSize: 13 }}>Deductions</h3></div>
              <div style={{ padding: '4px 16px 10px' }}>
                {a.deductions.map((e, k) => <Row key={k} l={e.label} v={e.amount} />)}
                <Row l={<b>Gross Deductions</b>} v={a.totals.grossDeductions} strong />
                <Row l={<b>Net Pay</b>} v={a.totals.netPay} strong tone="green" />
              </div>
            </div>
          </div>

          <div>
            <div className="faint small mb">Pay advice preview (exactly what the employee receives):</div>
            {pdfUrl === 'error' ? <div className="alert error">Could not render the PDF preview.</div>
              : !pdfUrl ? <div className="center" style={{ padding: 40 }}><Spinner dark /></div>
                : <iframe title="pay advice" src={pdfUrl} style={{ width: '100%', height: 520, border: '1px solid var(--line)', borderRadius: 8 }} />}
          </div>
        </div>
      )}
    </Modal>
  );
}

function Row({ l, v, strong, tone }) {
  return (
    <div className="row between" style={{ padding: '6px 0', borderTop: strong ? '1px solid var(--line)' : 'none' }}>
      <span className="small" style={{ color: tone === 'green' ? 'var(--green-dk)' : undefined }}>{l}</span>
      <span className="mono small" style={{ fontWeight: strong ? 800 : 600, color: tone === 'green' ? 'var(--green-dk)' : undefined }}>{naira(v)}</span>
    </div>
  );
}
