import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { Modal, Badge, Spinner } from './ui';
import { useToast } from './Toast';
import { naira, statusBadge, dateTime } from '../utils/format';
import { useAuth } from '../auth/AuthContext';
import { can } from '../utils/permissions';

// Employee detail + PDF preview + resend; admins can also correct or delete the record.
export default function EmployeeDrawer({ empId, onClose, onChanged }) {
  const toast = useToast();
  const { user } = useAuth();
  const maySend = can(user, 'payroll.send');
  const mayEdit = can(user, 'payroll.edit');
  const mayDelete = can(user, 'payroll.delete');
  const [emp, setEmp] = useState(null);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [resending, setResending] = useState(false);
  const [form, setForm] = useState(null); // non-null = editing
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [version, setVersion] = useState(0); // bump to reload after an edit

  useEffect(() => {
    let revoke;
    setPdfUrl(null);
    api.get(`/payroll/employees/${empId}`).then(({ employee }) => setEmp(employee));
    // fetch pdf as blob (auth header needed)
    api.getRaw(`/payroll/employees/${empId}/pdf`)
      .then((r) => r.blob())
      .then((b) => { const u = URL.createObjectURL(b); revoke = u; setPdfUrl(u); })
      .catch(() => setPdfUrl('error'));
    return () => { if (revoke) URL.revokeObjectURL(revoke); };
  }, [empId, version]);

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

  function startEdit() {
    const a = emp.advice;
    setForm({
      name: a.employee.name, employeeId: a.employee.employeeId, email: emp.email,
      department: a.employee.department, designation: a.employee.designation,
      bank: a.employee.bank, accountNo: a.employee.accountNo, tin: a.bankTax?.tin || '',
      pfaName: a.pension?.pfaName || '', pensionPin: a.pension?.pensionPin || '', nhfNumber: a.pension?.nhfNumber || '',
      annualSalary: String(a.annualSalary ?? 0),
      earnings: a.earnings.map((x) => String(x.amount)),
      deductions: a.deductions.map((x) => String(x.amount)),
    });
  }

  async function save() {
    setSaving(true);
    try {
      const { employee } = await api.put(`/payroll/employees/${empId}`, form);
      setForm(null);
      setEmp(employee);
      setVersion((v) => v + 1); // re-render the PDF preview from the corrected data
      let note = 'The pay advice now uses the corrected details.';
      if (!employee.valid) note = 'Saved, but the record still has errors and will be skipped when sending.';
      else if (employee.email_status === 'sent') note = 'This employee was already emailed — use Resend to send the corrected pay advice.';
      toast.success('Record updated', note);
      onChanged && onChanged();
    } catch (e) {
      toast.error('Could not save', e.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    const sentNote = emp.email_status === 'sent' ? ' Their pay advice was already emailed; deleting does not recall it.' : '';
    if (!window.confirm(`Delete ${emp.name || 'this record'} from this payroll run? This cannot be undone.${sentNote}`)) return;
    setDeleting(true);
    try {
      await api.del(`/payroll/employees/${empId}`);
      toast.success('Record deleted', `${emp.name || 'The record'} was removed from this payroll run.`);
      onChanged && onChanged();
      onClose();
    } catch (e) {
      toast.error('Could not delete', e.message);
      setDeleting(false);
    }
  }

  function download() {
    // open blob in new tab
    if (pdfUrl && pdfUrl !== 'error') window.open(pdfUrl, '_blank');
  }

  const a = emp?.advice;
  return (
    <Modal size="lg" title={emp ? emp.name : 'Loading…'} onClose={onClose}
      footer={form ? (
        <>
          <button className="btn secondary" onClick={() => setForm(null)} disabled={saving}>Cancel</button>
          <button className="btn" onClick={save} disabled={saving}>{saving ? <Spinner /> : 'Save Changes'}</button>
        </>
      ) : (
        <>
          {mayDelete && emp && (
            <button className="btn secondary" style={{ color: 'var(--red)', marginRight: 'auto' }} onClick={remove} disabled={deleting || emp.email_status === 'sending'}>
              {deleting ? <Spinner dark /> : '🗑 Delete'}
            </button>
          )}
          {mayEdit && emp && (
            <button className="btn secondary" onClick={startEdit} disabled={emp.email_status === 'sending'}>✎ Edit</button>
          )}
          <button className="btn secondary" onClick={download} disabled={!pdfUrl || pdfUrl === 'error'}>⬇ Download PDF</button>
          {maySend && emp?.valid && (
            <button className="btn green" onClick={askResend} disabled={resending}>
              {resending ? <><Spinner /> Sending…</> : (emp.email_status === 'sent' ? 'Resend Pay Advice' : 'Send Pay Advice')}
            </button>
          )}
        </>
      )}
    >
      {!emp ? <div className="center" style={{ padding: 30 }}><Spinner dark /></div> : (
        <div className="modal-split" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          {form ? <EditForm emp={emp} form={form} setForm={setForm} /> : (
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
          )}

          <div>
            <div className="faint small mb">Pay advice preview (exactly what the employee receives):</div>
            {pdfUrl === 'error' ? <div className="alert error">Could not render the PDF preview.</div>
              : !pdfUrl ? <div className="center" style={{ padding: 40 }}><Spinner dark /></div>
                : (
                  <>
                    <iframe className="pdf-preview" title="pay advice" src={pdfUrl} style={{ width: '100%', height: 520, border: '1px solid var(--line)', borderRadius: 8 }} />
                    <div className="pdf-mobile-hint alert">The pay advice is ready. Tap <b>Download PDF</b> below to open it.</div>
                  </>
                )}
          </div>
        </div>
      )}
    </Modal>
  );
}

// Admin correction form — same fields as the pay advice, in the existing form styles.
function EditForm({ emp, form, setForm }) {
  const a = emp.advice;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const setLine = (kind, i) => (e) => {
    const next = [...form[kind]];
    next[i] = e.target.value;
    setForm({ ...form, [kind]: next });
  };
  const text = (k, label) => (
    <div className="field" key={k}><label>{label}</label><input className="input" value={form[k]} onChange={set(k)} /></div>
  );
  return (
    <div>
      {emp.email_status === 'sent' && (
        <div className="alert warn" style={{ marginBottom: 12 }}>
          This employee was already emailed. Saving does not resend — use <b>Resend Pay Advice</b> afterwards to send the corrected version.
        </div>
      )}
      <div className="grid cols-2">
        {text('name', 'Employee name')}
        {text('employeeId', 'Employee ID')}
        {text('email', 'Email address')}
        {text('department', 'Department')}
        {text('designation', 'Designation')}
        {text('bank', 'Bank')}
        {text('accountNo', 'Account No.')}
        {text('tin', 'TIN')}
        {text('pfaName', 'PFA name')}
        {text('pensionPin', 'Pension PIN')}
        {text('nhfNumber', 'NHF number')}
        <div className="field"><label>Annual salary</label><input className="input" inputMode="decimal" value={form.annualSalary} onChange={set('annualSalary')} /></div>
      </div>
      <div className="card mt" style={{ marginTop: 16 }}>
        <div className="card-head" style={{ padding: '12px 16px' }}><h3 style={{ fontSize: 13 }}>Earnings</h3></div>
        <div style={{ padding: '8px 16px' }}>
          {a.earnings.map((x, i) => <AmountRow key={i} label={x.label} value={form.earnings[i]} onChange={setLine('earnings', i)} />)}
        </div>
      </div>
      <div className="card mt" style={{ marginTop: 12 }}>
        <div className="card-head" style={{ padding: '12px 16px' }}><h3 style={{ fontSize: 13 }}>Deductions</h3></div>
        <div style={{ padding: '8px 16px' }}>
          {a.deductions.map((x, i) => <AmountRow key={i} label={x.label} value={form.deductions[i]} onChange={setLine('deductions', i)} />)}
        </div>
      </div>
      <p className="faint small" style={{ marginTop: 10 }}>
        If you change an amount, Gross Earnings, Gross Deductions and Net Pay are recalculated from the lines above.
      </p>
    </div>
  );
}

function AmountRow({ label, value, onChange }) {
  return (
    <div className="row between" style={{ padding: '4px 0', gap: 12 }}>
      <span className="small">{label}</span>
      <input className="input mono" style={{ width: 150, textAlign: 'right' }} inputMode="decimal" value={value} onChange={onChange} />
    </div>
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
