/**
 * payAdviceTemplate.js — returns the HTML for one employee pay advice,
 * reproducing the official AUN design (purple masthead, green section band,
 * employee info grid, bank/tax & pension blocks, annual-salary strip,
 * earnings/deductions breakdown, bold totals band, footer).
 *
 * IMPORTANT: only GREEN (mandatory) and non-zero BLUE (optional) fields are
 * ever passed in here. RED / internal fields (incl. email) never reach this.
 */
const { formatNaira } = require('../utils/naira');

const PURPLE = '#2f2170';
const PURPLE_DK = '#271a5e';
const GREEN = '#3aa835';
const RED_DOT = '#e2483d';
const INK = '#1f2430';
const MUTED = '#8a8f9a';
const LINE = '#e6e7ec';
const LAV = '#efeef8';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function infoCell(label, value) {
  return `<td class="info-cell">
      <div class="info-label">${esc(label)}</div>
      <div class="info-value">${esc(value || '—')}</div>
    </td>`;
}

function detailRow(label, value) {
  const v = value == null || value === '' ? '' : value;
  return `<div class="detail-row">
      <span class="detail-label">${esc(label)}</span>
      <span class="detail-dots"></span>
      <span class="detail-value">${esc(v)}</span>
    </div>`;
}

function lineItem(label, amount) {
  return `<div class="li">
      <span class="li-label">${esc(label)}</span>
      <span class="li-amt">${formatNaira(amount)}</span>
    </div>`;
}

function renderPayAdviceHtml(advice, period, logoDataUri) {
  const e = advice.employee;
  const earnings = advice.earnings.map((x) => lineItem(x.label, x.amount)).join('');
  const deductions = advice.deductions.map((x) => lineItem(x.label, x.amount)).join('');
  const t = advice.totals;

  return `<!doctype html><html><head><meta charset="utf-8"/>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Helvetica Neue', Arial, sans-serif; color: ${INK};
         -webkit-print-color-adjust: exact; print-color-adjust: exact; font-size: 12px; }
  .sheet { width: 100%; padding: 0 0 24px; }

  /* Masthead */
  .masthead { background: ${PURPLE}; color: #fff; text-align: center; padding: 26px 40px 22px; }
  .masthead img { height: 62px; margin-bottom: 10px; }
  .uni-name { font-size: 22px; font-weight: 800; letter-spacing: .5px; font-family: Georgia, 'Times New Roman', serif; }
  .uni-addr { font-size: 10.5px; opacity: .92; margin-top: 6px; line-height: 1.5; }

  /* Green section band */
  .band-green { background: ${GREEN}; color: #fff; display: flex; justify-content: space-between;
                padding: 9px 40px; font-size: 11px; font-weight: 800; letter-spacing: 1px; }

  .pad { padding: 0 40px; }

  /* Employee info grid */
  table.info { width: 100%; border-collapse: collapse; margin-top: 2px; }
  .info-cell { width: 33.33%; padding: 14px 16px; border-bottom: 1px solid ${LINE}; vertical-align: top; }
  .info-label { color: ${MUTED}; font-size: 9px; font-weight: 700; letter-spacing: .8px; text-transform: uppercase; }
  .info-value { font-size: 13px; font-weight: 700; margin-top: 5px; color: ${INK}; }

  /* Bank/Tax + Pension */
  .two-col { display: flex; margin-top: 20px; }
  .col { flex: 1; }
  .col.left { padding-right: 30px; border-right: 1px solid ${LINE}; }
  .col.right { padding-left: 30px; }
  .sub-head { font-size: 10px; font-weight: 800; letter-spacing: 1px; color: ${PURPLE};
              text-transform: uppercase; border-bottom: 2px solid #d9b23a; display: inline-block;
              padding-bottom: 3px; margin-bottom: 12px; }
  .detail-row { display: flex; align-items: baseline; margin: 7px 0; font-size: 11.5px; }
  .detail-label { color: ${MUTED}; }
  .detail-dots { flex: 1; border-bottom: 1px dotted #cfd2da; margin: 0 6px; transform: translateY(-3px); }
  .detail-value { font-weight: 700; }

  /* Annual salary strip */
  .annual { background: ${LAV}; margin: 20px 0 0; padding: 11px 40px; font-size: 11px;
            font-weight: 700; letter-spacing: .5px; color: ${PURPLE_DK}; }
  .annual b { font-size: 13px; }

  /* Breakdown band */
  .band-purple { background: ${PURPLE}; color: #fff; padding: 8px 40px; font-size: 11px;
                 font-weight: 800; letter-spacing: 1px; text-transform: uppercase; }

  .break { display: flex; margin-top: 18px; }
  .break .col.left { padding-right: 34px; border-right: 1px solid ${LINE}; }
  .break .col.right { padding-left: 34px; }
  .grp-head { font-size: 13px; font-weight: 800; margin-bottom: 10px; display: flex; align-items: center; }
  .dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; margin-right: 8px; }
  .dot.g { background: ${GREEN}; }
  .dot.r { background: ${RED_DOT}; }
  .rule { height: 2px; background: ${GREEN}; margin: 2px 0 10px; }
  .rule.r { background: ${RED_DOT}; }
  .li { display: flex; justify-content: space-between; padding: 8px 6px; font-size: 12px; }
  .li:nth-child(even) { background: #f7f7fb; }
  .li-amt { font-weight: 800; }

  /* Totals band */
  .totals { background: ${PURPLE}; color: #fff; margin-top: 22px; display: flex; text-align: center;
            padding: 20px 20px; }
  .totals .cell { flex: 1; }
  .totals .cap { font-size: 10px; font-weight: 800; letter-spacing: 1px; opacity: .9; }
  .totals .val { font-size: 19px; font-weight: 800; margin-top: 8px; }

  .footer { background: ${LAV}; color: #6b6f7a; text-align: center; font-size: 9.5px;
            padding: 12px; margin-top: 0; }
</style></head>
<body>
  <div class="sheet">
    <div class="masthead">
      ${logoDataUri ? `<img src="${logoDataUri}" alt="AUN"/>` : ''}
      <div class="uni-name">AMERICAN UNIVERSITY OF NIGERIA</div>
      <div class="uni-addr">LAMIDO ZUBAIRU WAY, YOLA TOWNSHIP BY-PASS, PMB 2250 YOLA, ADAMAWA STATE, NIGERIA<br/>WEBSITE: www.aun.edu.ng</div>
    </div>

    <div class="band-green"><span>EMPLOYEE PAY ADVICE</span><span>PERIOD: ${esc(String(period).toUpperCase())}</span></div>

    <div class="pad">
      <table class="info">
        <tr>
          ${infoCell('Employee Name', e.name)}
          ${infoCell('Employee ID', e.employeeId)}
          ${infoCell('Department', e.department)}
        </tr>
        <tr>
          ${infoCell('Designation', e.designation)}
          ${infoCell('Bank Name', e.bank)}
          ${infoCell('Account Number', e.accountNo)}
        </tr>
      </table>

      <div class="two-col">
        <div class="col left">
          <div class="sub-head">Bank &amp; Tax Details</div>
          ${detailRow('TIN', advice.bankTax.tin)}
        </div>
        <div class="col right">
          <div class="sub-head">Pension Details</div>
          ${detailRow('PFA Name', advice.pension.pfaName)}
          ${detailRow('Pension PIN', advice.pension.pensionPin)}
          ${detailRow('NHF Number', advice.pension.nhfNumber)}
        </div>
      </div>
    </div>

    <div class="annual">ANNUAL SALARY: &nbsp; <b>${formatNaira(advice.annualSalary)}</b></div>

    <div class="band-purple">Earnings &amp; Deductions Breakdown</div>

    <div class="pad break">
      <div class="col left">
        <div class="grp-head"><span class="dot g"></span>Gross Earnings</div>
        <div class="rule"></div>
        ${earnings}
      </div>
      <div class="col right">
        <div class="grp-head"><span class="dot r"></span>Gross Deductions</div>
        <div class="rule r"></div>
        ${deductions}
      </div>
    </div>

    <div class="pad">
      <div class="totals">
        <div class="cell"><div class="cap">GROSS EARNINGS</div><div class="val">${formatNaira(t.grossEarnings)}</div></div>
        <div class="cell"><div class="cap">GROSS DEDUCTIONS</div><div class="val">${formatNaira(t.grossDeductions)}</div></div>
        <div class="cell"><div class="cap">NET PAY</div><div class="val">${formatNaira(t.netPay)}</div></div>
      </div>
    </div>

    <div class="footer">This is a computer-generated payslip. &nbsp;|&nbsp; American University of Nigeria &nbsp;|&nbsp; www.aun.edu.ng</div>
  </div>
</body></html>`;
}

module.exports = { renderPayAdviceHtml };
