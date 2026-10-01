import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { useToast } from '../components/Toast';
import { Spinner } from '../components/ui';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function Upload() {
  const nav = useNavigate();
  const toast = useToast();
  const inputRef = useRef();
  const [file, setFile] = useState(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const now = new Date();
  const [month, setMonth] = useState(MONTHS[now.getMonth()]);
  const [year, setYear] = useState(now.getFullYear());

  const years = [];
  for (let y = now.getFullYear() + 1; y >= 2022; y -= 1) years.push(y);

  function pick(f) {
    if (!f) return;
    const ok = /\.xlsx$/i.test(f.name);
    if (!ok) { toast.error('Invalid file', 'Only .xlsx Excel workbooks are accepted. In Excel use File → Save As → Excel Workbook (.xlsx).'); return; }
    setFile(f);
  }

  async function submit() {
    if (!file) { toast.error('No file', 'Please choose a payroll Excel file.'); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('period', `${month} ${year}`);
      const res = await api.upload('/payroll/upload', fd);
      toast.success('File processed', `${res.summary.total} employees imported.${res.replacedRuns ? ' The previous unsent upload for this period was replaced.' : ''}`);
      nav(`/history/${res.runId}`);
    } catch (e) {
      toast.error('Upload failed', e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <div className="card card-pad mb">
        <h3 style={{ marginBottom: 4 }}>1 · Select Payroll Period</h3>
        <p className="faint small mb">The period is printed on every pay advice and email. It is not assumed from today's date.</p>
        <div className="row" style={{ gap: 12 }}>
          <div className="field" style={{ flex: 1, marginBottom: 0 }}>
            <label>Month</label>
            <select className="select" value={month} onChange={(e) => setMonth(e.target.value)}>
              {MONTHS.map((m) => <option key={m}>{m}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: 1, marginBottom: 0 }}>
            <label>Year</label>
            <select className="select" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {years.map((y) => <option key={y}>{y}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="card card-pad">
        <h3 style={{ marginBottom: 4 }}>2 · Upload Payroll Workbook</h3>
        <p className="faint small mb">Accepted format: .xlsx (max 10 MB). The file is processed in memory and never stored.</p>

        <div
          className={`dropzone ${drag ? 'drag' : ''}`}
          onClick={() => inputRef.current.click()}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files[0]); }}
        >
          <input ref={inputRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(e) => pick(e.target.files[0])} />
          {file ? (
            <>
              <div className="big">📗</div>
              <h4>{file.name}</h4>
              <p className="faint small">{(file.size / 1024).toFixed(0)} KB — click to choose a different file</p>
            </>
          ) : (
            <>
              <div className="big">⬆️</div>
              <h4>Drag & drop your payroll file here</h4>
              <p className="faint small">or click to browse</p>
            </>
          )}
        </div>

        <div className="row between mt">
          <span className="faint small">Period: <b>{month} {year}</b></span>
          <button className="btn" disabled={!file || busy} onClick={submit}>
            {busy ? <><Spinner /> Processing…</> : 'Upload & Validate →'}
          </button>
        </div>
      </div>
    </div>
  );
}
