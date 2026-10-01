/**
 * excelService.js — parse an uploaded AUN payroll workbook into validated
 * employee pay-advice records, applying the GREEN / BLUE / RED colour rules.
 *
 * Colour classification is taken from utils/columns.js (derived from the real
 * template colours). If the uploaded workbook itself contains a colour legend
 * row, we ALSO re-derive the map from its actual fills, so we honour the
 * template's formatting rather than blindly hard-coding.
 *
 * The original uploaded file is never modified.
 */
const ExcelJS = require('exceljs');
const env = require('../config/env');
const cols = require('../utils/columns');
const { parseAmount, hasMeaningfulValue } = require('../utils/numbers');
const { isValidEmail, isBlank, cleanText } = require('../utils/validators');

const badFile = (message) => Object.assign(new Error(message), { status: 400 });

/** Columns without which a workbook cannot produce and deliver pay advices. */
const REQUIRED_COLUMNS = ['employee names', 'employee id no', 'email address', 'gross pay', 'total deductions', 'net pay'];

/** Max lengths (match the MongoDB schema) → over-long values make the ROW invalid. */
const FIELD_LIMITS = [
  ['name', 'Employee name', 200], ['employeeId', 'Employee ID', 64], ['department', 'Department', 200],
  ['designation', 'Designation', 200], ['bank', 'Bank', 120], ['accountNo', 'Account number', 40],
];
const OTHER_LIMITS = [
  [(a) => a.bankTax.tin, 'TIN', 40], [(a) => a.pension.pfaName, 'PFA name', 200],
  [(a) => a.pension.pensionPin, 'Pension PIN', 40], [(a) => a.pension.nhfNumber, 'NHF number', 40],
];
const MAX_AMOUNT = 1e11; // ₦100bn — anything larger is a data error

const FILL_COLOR = {
  FF00B050: 'green',
  FFFF0000: 'red',
  FF0070C0: 'blue',
};

/** Extract a primitive value from an ExcelJS cell value (handles rich/formula). */
function cellValue(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('result' in v) return v.result; // formula
    if ('text' in v) return v.text; // hyperlink
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('');
    if ('hyperlink' in v) return v.text || v.hyperlink;
    return null;
  }
  return v;
}

function cleanString(v) {
  const p = cellValue(v);
  if (p === null || p === undefined) return '';
  if (p instanceof Date) return p.toISOString().slice(0, 10);
  return cleanText(p); // strips control / invisible characters (incl. CR/LF)
}

/** Account numbers, PINs etc. must keep leading zeros and drop trailing ".0". */
function cleanIdentifier(v) {
  let s = cleanString(v);
  if (/^\d+\.0$/.test(s)) s = s.replace(/\.0$/, '');
  return s;
}

function fillColorOf(cell) {
  const f = cell && cell.fill;
  if (!f || f.type !== 'pattern' || !f.fgColor) return null;
  const argb = (f.fgColor.argb || '').toUpperCase();
  return FILL_COLOR[argb] || null;
}

/**
 * Scan the first few rows for a colour-legend row (mostly coloured, ~no text).
 * Returns { legendRowNumber, colorByCol } or null.
 */
function deriveColorMapFromSheet(ws, headerRow) {
  const maxScan = Math.min(ws.rowCount, headerRow + 4);
  for (let r = headerRow + 1; r <= maxScan; r += 1) {
    const row = ws.getRow(r);
    let colored = 0;
    let withText = 0;
    const colorByCol = {};
    for (let c = 1; c <= ws.columnCount; c += 1) {
      const cell = row.getCell(c);
      const col = fillColorOf(cell);
      if (col) {
        colored += 1;
        colorByCol[c] = col;
      }
      if (!isBlank(cellValue(cell.value))) withText += 1;
    }
    // Heuristic: a legend row is mostly coloured and mostly empty of values.
    if (colored >= ws.columnCount * 0.5 && withText <= ws.columnCount * 0.15) {
      return { legendRowNumber: r, colorByCol };
    }
  }
  return null;
}

/** Locate the header row (best match against known column names). */
function findHeaderRow(ws) {
  let best = { row: 1, score: -1 };
  const maxScan = Math.min(ws.rowCount, 8) || 1;
  for (let r = 1; r <= maxScan; r += 1) {
    const row = ws.getRow(r);
    let score = 0;
    for (let c = 1; c <= ws.columnCount; c += 1) {
      const n = cols.normalizeHeader(cellValue(row.getCell(c).value));
      if (n && cols.BY_NORM.has(n)) score += 1;
    }
    if (score > best.score) best = { row: r, score };
  }
  return best.row;
}

/**
 * Build a per-column plan: { colIndex, def, isEmail }.
 * def comes from the classification keyed by header name; colour from legend
 * (if present) is used to reconcile/annotate.
 */
function buildColumnPlan(ws, headerRow, legend) {
  const plan = [];
  const headerRowObj = ws.getRow(headerRow);
  const missingColumns = new Set(cols.REQUIRED_IDENTITY);
  for (let c = 1; c <= ws.columnCount; c += 1) {
    const rawHeader = cellValue(headerRowObj.getCell(c).value);
    const norm = cols.normalizeHeader(rawHeader);
    if (!norm) continue;
    const def = cols.classify(norm);
    if (!def) continue; // unknown column — ignored (never printed)
    missingColumns.delete(norm);
    const legendColor = legend ? legend.colorByCol[c] : null;
    plan.push({
      colIndex: c,
      def,
      color: legendColor || def.color,
      isEmail: norm === cols.EMAIL_NORM,
    });
  }
  return { plan, missingColumns: [...missingColumns] };
}

/** Turn one data row into a pay-advice record. */
function buildEmployee(ws, rowNumber, plan) {
  const row = ws.getRow(rowNumber);
  const rec = {
    rowNumber,
    identity: {},
    email: '',
    earnings: [],
    deductions: [],
    totals: { grossPay: 0, totalDeductions: 0, netPay: 0 },
    annualSalary: 0,
    numericIssues: [],
  };

  for (const p of plan) {
    const cell = row.getCell(p.colIndex);
    const { def } = p;

    if (p.isEmail) {
      rec.email = cleanString(cell.value).replace(/^mailto:/i, '').toLowerCase();
      continue;
    }
    if (def.color === 'red') continue; // internal only — never captured for the advice

    if (def.role === 'identity') {
      if (def.norm === 'annual salary') {
        const a = parseAmount(cellValue(cell.value));
        if (!a.ok) rec.numericIssues.push(`Annual Salary: "${a.raw}"`);
        rec.annualSalary = a.value || 0;
      } else {
        rec.identity[def.norm] = def.norm === 'account no.' ? cleanIdentifier(cell.value) : cleanString(cell.value);
      }
      continue;
    }

    if (def.role === 'total') {
      const a = parseAmount(cellValue(cell.value));
      if (!a.ok) rec.numericIssues.push(`${def.header}: "${a.raw}"`);
      rec.totals[def.key] = a.value || 0;
      continue;
    }

    // earning / deduction line item (green base or blue optional)
    const a = parseAmount(cellValue(cell.value));
    if (!a.ok) {
      rec.numericIssues.push(`${def.header}: "${a.raw}"`);
    }
    const amount = a.value || 0;
    const isBase = def.color === 'green';
    const show = isBase || hasMeaningfulValue(a); // blue only when > 0
    if (show) {
      const line = { label: def.label, amount, color: def.color, header: def.header };
      if (def.role === 'earning') rec.earnings.push(line);
      else rec.deductions.push(line);
    }
  }

  // Authoritative totals (source of truth) + reconciliation check
  const earnSum = rec.earnings.reduce((s, e) => s + e.amount, 0);
  const dedSum = rec.deductions.reduce((s, e) => s + e.amount, 0);
  const grossEarnings = rec.totals.grossPay;
  const grossDeductions = rec.totals.totalDeductions;
  const netPay = rec.totals.netPay;
  const near = (a, b) => Math.abs((a || 0) - (b || 0)) <= 1.0;

  rec.advice = {
    employee: {
      name: rec.identity['employee names'] || '',
      employeeId: rec.identity['employee id no'] || '',
      department: rec.identity.department || '',
      designation: rec.identity.designation || '',
      bank: rec.identity.bank || '',
      accountNo: rec.identity['account no.'] || '',
    },
    bankTax: { tin: rec.identity.tin || '' },
    pension: {
      pfaName: rec.identity.pfa || '',
      pensionPin: rec.identity['pension pin'] || '',
      nhfNumber: rec.identity['nhf pin'] || '',
    },
    annualSalary: rec.annualSalary,
    earnings: rec.earnings.map(({ label, amount }) => ({ label, amount })),
    deductions: rec.deductions.map(({ label, amount }) => ({ label, amount })),
    totals: { grossEarnings, grossDeductions, netPay },
    reconciliation: {
      earningsSum: earnSum,
      deductionsSum: dedSum,
      earningsMatch: near(earnSum, grossEarnings),
      deductionsMatch: near(dedSum, grossDeductions),
      netMatch: near(grossEarnings - grossDeductions, netPay),
    },
  };
  return rec;
}

/** Validate a built record; returns array of issue strings (empty = valid). */
function validateRecord(rec) {
  const issues = [];
  const a = rec.advice.employee;
  if (isBlank(a.name)) issues.push('Missing employee name');
  if (isBlank(a.employeeId)) issues.push('Missing employee ID');
  if (isBlank(a.department)) issues.push('Missing department');
  if (isBlank(a.designation)) issues.push('Missing designation');
  if (isBlank(a.bank)) issues.push('Missing bank');
  if (isBlank(a.accountNo)) issues.push('Missing account number');
  if (isBlank(rec.email)) issues.push('Missing email address');
  else if (!isValidEmail(rec.email)) issues.push('Invalid email address');
  rec.numericIssues.forEach((n) => issues.push(`Invalid numeric value — ${n}`));

  // lengths (a single over-long cell invalidates the row, not the whole file)
  FIELD_LIMITS.forEach(([k, label, max]) => { if ((a[k] || '').length > max) issues.push(`${label} is too long (max ${max} characters)`); });
  OTHER_LIMITS.forEach(([get, label, max]) => { if ((get(rec.advice) || '').length > max) issues.push(`${label} is too long (max ${max} characters)`); });
  if (rec.email.length > 254) issues.push('Email address is too long');

  // amounts: finite, sane magnitude, totals not negative
  const t = rec.advice.totals;
  const amounts = [t.grossEarnings, t.grossDeductions, t.netPay, rec.advice.annualSalary,
    ...rec.advice.earnings.map((x) => x.amount), ...rec.advice.deductions.map((x) => x.amount)];
  if (amounts.some((x) => !Number.isFinite(x) || Math.abs(x) > MAX_AMOUNT)) issues.push('An amount is out of range');
  if (t.grossEarnings < 0) issues.push('Gross pay cannot be negative');
  if (t.netPay < 0) issues.push('Net pay cannot be negative');
  if (!rec.advice.reconciliation.netMatch) {
    issues.push('Net pay does not reconcile with gross earnings minus deductions (warning)');
  }
  return issues;
}

/** True if the row has essentially no data (skip it). */
function isEmptyRow(ws, rowNumber, plan) {
  const row = ws.getRow(rowNumber);
  for (const p of plan) {
    if (!isBlank(cellValue(row.getCell(p.colIndex).value))) return false;
  }
  return true;
}

/**
 * Main entry. Parses a workbook buffer.
 * @returns { columns, employees, summary }
 */
async function parseWorkbook(buffer) {
  const wb = new ExcelJS.Workbook();
  try {
    // Parsing only: ExcelJS never evaluates formulas or runs macros; cached
    // formula RESULTS are read as values.
    await wb.xlsx.load(buffer);
  } catch (e) {
    throw badFile('The file could not be read as an Excel workbook. Open it in Excel, save it as .xlsx and try again.');
  }
  // First VISIBLE sheet — a hidden sheet must never silently supply payroll data.
  const ws = wb.worksheets.find((w) => !w.state || w.state === 'visible');
  if (!ws) throw badFile('The workbook has no visible worksheets.');
  if (ws.columnCount > env.MAX_COLUMNS) {
    throw badFile(`The worksheet has too many columns (${ws.columnCount}; maximum ${env.MAX_COLUMNS}).`);
  }
  if (ws.actualRowCount > env.MAX_ROWS + 10) {
    throw badFile(`The worksheet has too many rows (${ws.actualRowCount}; maximum ${env.MAX_ROWS} employees).`);
  }

  const headerRow = findHeaderRow(ws);
  const legend = deriveColorMapFromSheet(ws, headerRow);
  const { plan, missingColumns } = buildColumnPlan(ws, headerRow, legend);

  if (plan.length === 0) {
    throw Object.assign(
      new Error('This does not look like an AUN payroll workbook — no known columns were found.'),
      { status: 400 },
    );
  }
  // Hard requirement: columns needed to build AND deliver every pay advice.
  const present = new Set(plan.map((p) => p.def.norm));
  const criticalMissing = REQUIRED_COLUMNS.filter((c) => !present.has(c));
  if (criticalMissing.length) {
    const names = criticalMissing.map((c) => `"${(cols.BY_NORM.get(c) || {}).header || c}"`);
    throw badFile(`The uploaded file is missing required column(s): ${names.join(', ')}.`);
  }

  const skipRows = new Set([headerRow]);
  if (legend) skipRows.add(legend.legendRowNumber);

  // Only rows that actually contain values (a sheet "formatted" down to row
  // 1,048,576 must not cost a million iterations).
  const dataRows = [];
  ws.eachRow({ includeEmpty: false }, (row, r) => { if (r > headerRow && !skipRows.has(r)) dataRows.push(r); });
  if (dataRows.length > env.MAX_ROWS) {
    throw badFile(`The worksheet has too many rows (${dataRows.length}; maximum ${env.MAX_ROWS} employees).`);
  }

  const employees = [];
  const seenIds = new Map();
  const seenEmails = new Map();

  for (const r of dataRows) {
    if (isEmptyRow(ws, r, plan)) continue;
    const rec = buildEmployee(ws, r, plan);
    const issues = validateRecord(rec);

    // duplicate detection
    const idKey = (rec.advice.employee.employeeId || '').toLowerCase();
    const emKey = (rec.email || '').toLowerCase();
    if (idKey) {
      if (seenIds.has(idKey)) issues.push(`Duplicate employee ID (also row ${seenIds.get(idKey)})`);
      else seenIds.set(idKey, r);
    }
    if (emKey) {
      if (seenEmails.has(emKey)) issues.push(`Duplicate email (also row ${seenEmails.get(emKey)})`);
      else seenEmails.set(emKey, r);
    }

    const hardIssues = issues.filter((i) => !i.includes('(warning)'));
    employees.push({
      rowNumber: r,
      employeeId: rec.advice.employee.employeeId,
      name: rec.advice.employee.name,
      email: rec.email,
      department: rec.advice.employee.department,
      designation: rec.advice.employee.designation,
      bank: rec.advice.employee.bank,
      accountNo: rec.advice.employee.accountNo,
      grossPay: rec.totals.grossPay,
      totalDeductions: rec.totals.totalDeductions,
      netPay: rec.totals.netPay,
      advice: rec.advice,
      issues,
      valid: hardIssues.length === 0,
    });
  }

  if (employees.length === 0) throw badFile('The worksheet contains no employee rows.');

  const summary = buildSummary(employees, missingColumns);
  const columns = plan.map((p) => ({ header: p.def.header, color: p.color, role: p.def.role }));
  return { columns, employees, summary, headerRow, legendDetected: !!legend };
}

function buildSummary(employees, missingColumns) {
  const s = {
    total: employees.length,
    valid: 0,
    invalid: 0,
    missingEmail: 0,
    invalidEmail: 0,
    missingId: 0,
    missingName: 0,
    invalidNumeric: 0,
    duplicateId: 0,
    duplicateEmail: 0,
    reconcileWarnings: 0,
    missingColumns,
  };
  for (const e of employees) {
    if (e.valid) s.valid += 1;
    else s.invalid += 1;
    const j = e.issues.join(' | ');
    if (j.includes('Missing email')) s.missingEmail += 1;
    if (j.includes('Invalid email')) s.invalidEmail += 1;
    if (j.includes('Missing employee ID')) s.missingId += 1;
    if (j.includes('Missing employee name')) s.missingName += 1;
    if (j.includes('Invalid numeric')) s.invalidNumeric += 1;
    if (j.includes('Duplicate employee ID')) s.duplicateId += 1;
    if (j.includes('Duplicate email')) s.duplicateEmail += 1;
    if (j.includes('does not reconcile')) s.reconcileWarnings += 1;
  }
  return s;
}

module.exports = { parseWorkbook, deriveColorMapFromSheet, findHeaderRow };
