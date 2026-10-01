/**
 * columns.js  —  AUN Payroll column classification (SOURCE OF TRUTH)
 * -----------------------------------------------------------------
 * This mapping was DERIVED from the actual fill colours in the uploaded
 * payroll template ("payroll sample column.xlsx"), legend row 3:
 *     GREEN  (00B050) -> mandatory pay-advice field
 *     BLUE   (0070C0) -> optional earning / deduction (show only if > 0)
 *     RED    (FF0000) -> internal only, NEVER printed on the pay advice
 *
 * The Excel service can ALSO re-derive this at runtime from a legend row if
 * the uploaded file contains one (see excelService.deriveColorMapFromSheet),
 * so colours are not blindly hard-coded — this is the verified fallback used
 * for normal monthly files that have no legend row.
 *
 * `role`:  identity | earning | deduction | total | internal
 * `key` :  set for the three authoritative totals (grossPay/totalDeductions/netPay)
 */

const COLUMN_DEFS = [
  {
    "col": "A",
    "header": "BANK",
    "norm": "bank",
    "color": "green",
    "role": "identity",
    "label": "BANK",
    "key": null
  },
  {
    "col": "B",
    "header": "PFA",
    "norm": "pfa",
    "color": "green",
    "role": "identity",
    "label": "PFA Name",
    "key": null
  },
  {
    "col": "C",
    "header": "Pension Pin",
    "norm": "pension pin",
    "color": "green",
    "role": "identity",
    "label": "Pension PIN",
    "key": null
  },
  {
    "col": "D",
    "header": "NHF Pin",
    "norm": "nhf pin",
    "color": "green",
    "role": "identity",
    "label": "NHF Number",
    "key": null
  },
  {
    "col": "E",
    "header": "TIN",
    "norm": "tin",
    "color": "green",
    "role": "identity",
    "label": "TIN",
    "key": null
  },
  {
    "col": "F",
    "header": "Email Address",
    "norm": "email address",
    "color": "red",
    "role": "internal",
    "label": "Email Address",
    "key": null
  },
  {
    "col": "G",
    "header": "S/R",
    "norm": "s/r",
    "color": "red",
    "role": "internal",
    "label": "S/R",
    "key": null
  },
  {
    "col": "H",
    "header": "Employee Names",
    "norm": "employee names",
    "color": "green",
    "role": "identity",
    "label": "Employee Name",
    "key": null
  },
  {
    "col": "I",
    "header": "Employee ID No",
    "norm": "employee id no",
    "color": "green",
    "role": "identity",
    "label": "Employee ID",
    "key": null
  },
  {
    "col": "J",
    "header": "ACCOUNT NO.",
    "norm": "account no.",
    "color": "green",
    "role": "identity",
    "label": "Account Number",
    "key": null
  },
  {
    "col": "K",
    "header": "FUND",
    "norm": "fund",
    "color": "red",
    "role": "internal",
    "label": "FUND",
    "key": null
  },
  {
    "col": "L",
    "header": "ORG",
    "norm": "org",
    "color": "red",
    "role": "internal",
    "label": "ORG",
    "key": null
  },
  {
    "col": "M",
    "header": "ACCT",
    "norm": "acct",
    "color": "red",
    "role": "internal",
    "label": "ACCT",
    "key": null
  },
  {
    "col": "N",
    "header": "PROG",
    "norm": "prog",
    "color": "red",
    "role": "internal",
    "label": "PROG",
    "key": null
  },
  {
    "col": "O",
    "header": "Hire Date",
    "norm": "hire date",
    "color": "red",
    "role": "internal",
    "label": "Hire Date",
    "key": null
  },
  {
    "col": "P",
    "header": "End of Contract Date",
    "norm": "end of contract date",
    "color": "red",
    "role": "internal",
    "label": "End of Contract Date",
    "key": null
  },
  {
    "col": "Q",
    "header": "Date of Change of Status/Extension",
    "norm": "date of change of status/extension",
    "color": "red",
    "role": "internal",
    "label": "Date of Change of Status/Extension",
    "key": null
  },
  {
    "col": "R",
    "header": "End Date",
    "norm": "end date",
    "color": "red",
    "role": "internal",
    "label": "End Date",
    "key": null
  },
  {
    "col": "S",
    "header": "Date of Change of Status/Extension",
    "norm": "date of change of status/extension",
    "color": "red",
    "role": "internal",
    "label": "Date of Change of Status/Extension",
    "key": null
  },
  {
    "col": "T",
    "header": "End Date",
    "norm": "end date",
    "color": "red",
    "role": "internal",
    "label": "End Date",
    "key": null
  },
  {
    "col": "U",
    "header": "Date of Change of Status/Extension",
    "norm": "date of change of status/extension",
    "color": "red",
    "role": "internal",
    "label": "Date of Change of Status/Extension",
    "key": null
  },
  {
    "col": "V",
    "header": "End Date",
    "norm": "end date",
    "color": "red",
    "role": "internal",
    "label": "End Date",
    "key": null
  },
  {
    "col": "W",
    "header": "Status",
    "norm": "status",
    "color": "red",
    "role": "internal",
    "label": "Status",
    "key": null
  },
  {
    "col": "X",
    "header": "Department",
    "norm": "department",
    "color": "green",
    "role": "identity",
    "label": "Department",
    "key": null
  },
  {
    "col": "Y",
    "header": "Designation",
    "norm": "designation",
    "color": "green",
    "role": "identity",
    "label": "Designation",
    "key": null
  },
  {
    "col": "Z",
    "header": "Annual Salary",
    "norm": "annual salary",
    "color": "green",
    "role": "identity",
    "label": "Annual Salary",
    "key": null
  },
  {
    "col": "AA",
    "header": "Monthly Basic",
    "norm": "monthly basic",
    "color": "green",
    "role": "earning",
    "label": "Basic Salary",
    "key": null
  },
  {
    "col": "AB",
    "header": "Housing",
    "norm": "housing",
    "color": "green",
    "role": "earning",
    "label": "Housing Allowance",
    "key": null
  },
  {
    "col": "AC",
    "header": "Transportation",
    "norm": "transportation",
    "color": "green",
    "role": "earning",
    "label": "Transport Allowance",
    "key": null
  },
  {
    "col": "AD",
    "header": "Others",
    "norm": "others",
    "color": "green",
    "role": "earning",
    "label": "Other Allowance",
    "key": null
  },
  {
    "col": "AE",
    "header": "Intra Transportation",
    "norm": "intra transportation",
    "color": "blue",
    "role": "earning",
    "label": "Intra Transportation",
    "key": null
  },
  {
    "col": "AF",
    "header": "Workstudy Stipend",
    "norm": "workstudy stipend",
    "color": "blue",
    "role": "earning",
    "label": "Workstudy Stipend",
    "key": null
  },
  {
    "col": "AG",
    "header": "Corper Stipend",
    "norm": "corper stipend",
    "color": "blue",
    "role": "earning",
    "label": "Corper Stipend",
    "key": null
  },
  {
    "col": "AH",
    "header": "Responsibility Allowance",
    "norm": "responsibility allowance",
    "color": "blue",
    "role": "earning",
    "label": "Responsibility Allowance",
    "key": null
  },
  {
    "col": "AI",
    "header": "Teaching Stipend",
    "norm": "teaching stipend",
    "color": "blue",
    "role": "earning",
    "label": "Teaching Stipend",
    "key": null
  },
  {
    "col": "AJ",
    "header": "Acting Stipend",
    "norm": "acting stipend",
    "color": "blue",
    "role": "earning",
    "label": "Acting Stipend",
    "key": null
  },
  {
    "col": "AK",
    "header": "Retro-Active Salary",
    "norm": "retro-active salary",
    "color": "blue",
    "role": "earning",
    "label": "Retro-Active Salary",
    "key": null
  },
  {
    "col": "AM",
    "header": "Health Insurance Refund",
    "norm": "health insurance refund",
    "color": "blue",
    "role": "earning",
    "label": "Health Insurance Refund",
    "key": null
  },
  {
    "col": "AN",
    "header": "AUN Health Centre Refund",
    "norm": "aun health centre refund",
    "color": "blue",
    "role": "earning",
    "label": "AUN Health Centre Refund",
    "key": null
  },
  {
    "col": "AO",
    "header": "International Travels",
    "norm": "international travels",
    "color": "blue",
    "role": "earning",
    "label": "International Travels",
    "key": null
  },
  {
    "col": "AP",
    "header": "AUN Housing Refund",
    "norm": "aun housing refund",
    "color": "blue",
    "role": "earning",
    "label": "AUN Housing Refund",
    "key": null
  },
  {
    "col": "AQ",
    "header": "Hazard Allowance",
    "norm": "hazard allowance",
    "color": "blue",
    "role": "earning",
    "label": "Hazard Allowance",
    "key": null
  },
  {
    "col": "AR",
    "header": "Asset Custodian Stipend",
    "norm": "asset custodian stipend",
    "color": "blue",
    "role": "earning",
    "label": "Asset Custodian Stipend",
    "key": null
  },
  {
    "col": "AS",
    "header": "Acomodation",
    "norm": "acomodation",
    "color": "blue",
    "role": "earning",
    "label": "Acomodation",
    "key": null
  },
  {
    "col": "AT",
    "header": "Cooperative Refund",
    "norm": "cooperative refund",
    "color": "blue",
    "role": "earning",
    "label": "Cooperative Refund",
    "key": null
  },
  {
    "col": "AU",
    "header": "Tax Refund",
    "norm": "tax refund",
    "color": "blue",
    "role": "earning",
    "label": "Tax Refund",
    "key": null
  },
  {
    "col": "AV",
    "header": "Donations",
    "norm": "donations",
    "color": "blue",
    "role": "earning",
    "label": "Donations",
    "key": null
  },
  {
    "col": "AW",
    "header": "Campus Store Refund",
    "norm": "campus store refund",
    "color": "blue",
    "role": "earning",
    "label": "Campus Store Refund",
    "key": null
  },
  {
    "col": "AX",
    "header": "Tuition Refund",
    "norm": "tuition refund",
    "color": "blue",
    "role": "earning",
    "label": "Tuition Refund",
    "key": null
  },
  {
    "col": "AY",
    "header": "Salary Advance Refund",
    "norm": "salary advance refund",
    "color": "blue",
    "role": "earning",
    "label": "Salary Advance Refund",
    "key": null
  },
  {
    "col": "AZ",
    "header": "Overload",
    "norm": "overload",
    "color": "blue",
    "role": "earning",
    "label": "Overload",
    "key": null
  },
  {
    "col": "BA",
    "header": "Leave Grant",
    "norm": "leave grant",
    "color": "blue",
    "role": "earning",
    "label": "Leave Grant",
    "key": null
  },
  {
    "col": "BB",
    "header": "Leave Encashment",
    "norm": "leave encashment",
    "color": "blue",
    "role": "earning",
    "label": "Leave Encashment",
    "key": null
  },
  {
    "col": "BC",
    "header": "Inlieu of Notice",
    "norm": "inlieu of notice",
    "color": "blue",
    "role": "earning",
    "label": "Inlieu of Notice",
    "key": null
  },
  {
    "col": "BD",
    "header": "Overtime",
    "norm": "overtime",
    "color": "blue",
    "role": "earning",
    "label": "Overtime",
    "key": null
  },
  {
    "col": "BE",
    "header": "Travels Advance Refund",
    "norm": "travels advance refund",
    "color": "blue",
    "role": "earning",
    "label": "Travels Advance Refund",
    "key": null
  },
  {
    "col": "BF",
    "header": "AUN Community School Refund",
    "norm": "aun community school refund",
    "color": "blue",
    "role": "earning",
    "label": "AUN Community School Refund",
    "key": null
  },
  {
    "col": "BG",
    "header": "Pension Refund",
    "norm": "pension refund",
    "color": "blue",
    "role": "earning",
    "label": "Pension Refund",
    "key": null
  },
  {
    "col": "BH",
    "header": "Staff award stipend",
    "norm": "staff award stipend",
    "color": "blue",
    "role": "earning",
    "label": "Staff award stipend",
    "key": null
  },
  {
    "col": "BI",
    "header": "Uniform Allowance",
    "norm": "uniform allowance",
    "color": "blue",
    "role": "earning",
    "label": "Uniform Allowance",
    "key": null
  },
  {
    "col": "BJ",
    "header": "Relocation Allowance",
    "norm": "relocation allowance",
    "color": "blue",
    "role": "earning",
    "label": "Relocation Allowance",
    "key": null
  },
  {
    "col": "BK",
    "header": "Bonus",
    "norm": "bonus",
    "color": "blue",
    "role": "earning",
    "label": "Bonus",
    "key": null
  },
  {
    "col": "BL",
    "header": "Gross Pay",
    "norm": "gross pay",
    "color": "green",
    "role": "total",
    "label": "Gross Earnings",
    "key": "grossPay"
  },
  {
    "col": "BM",
    "header": "Tax (PAYE)",
    "norm": "tax (paye)",
    "color": "green",
    "role": "deduction",
    "label": "Tax (PAYE)",
    "key": null
  },
  {
    "col": "BN",
    "header": "NHF",
    "norm": "nhf",
    "color": "green",
    "role": "deduction",
    "label": "National Housing Fund",
    "key": null
  },
  {
    "col": "BO",
    "header": "Pension",
    "norm": "pension",
    "color": "green",
    "role": "deduction",
    "label": "Contributory Pension",
    "key": null
  },
  {
    "col": "BP",
    "header": "Voluntary Contribution",
    "norm": "voluntary contribution",
    "color": "blue",
    "role": "deduction",
    "label": "Voluntary Contribution",
    "key": null
  },
  {
    "col": "BQ",
    "header": "Auction",
    "norm": "auction",
    "color": "blue",
    "role": "deduction",
    "label": "Auction",
    "key": null
  },
  {
    "col": "BR",
    "header": "Health Insurance",
    "norm": "health insurance",
    "color": "green",
    "role": "deduction",
    "label": "Health Insurance",
    "key": null
  },
  {
    "col": "BS",
    "header": "Medical bills",
    "norm": "medical bills",
    "color": "blue",
    "role": "deduction",
    "label": "Medical bills",
    "key": null
  },
  {
    "col": "BT",
    "header": "Salary Advance",
    "norm": "salary advance",
    "color": "blue",
    "role": "deduction",
    "label": "Salary Advance",
    "key": null
  },
  {
    "col": "BU",
    "header": "ICT Fees",
    "norm": "ict fees",
    "color": "blue",
    "role": "deduction",
    "label": "ICT Fees",
    "key": null
  },
  {
    "col": "BV",
    "header": "AUN Club Registration",
    "norm": "aun club registration",
    "color": "blue",
    "role": "deduction",
    "label": "AUN Club Registration",
    "key": null
  },
  {
    "col": "BW",
    "header": "University Club Food",
    "norm": "university club food",
    "color": "blue",
    "role": "deduction",
    "label": "University Club Food",
    "key": null
  },
  {
    "col": "BX",
    "header": "Courier Service",
    "norm": "courier service",
    "color": "blue",
    "role": "deduction",
    "label": "Courier Service",
    "key": null
  },
  {
    "col": "BY",
    "header": "AUN Housing Occupancy",
    "norm": "aun housing occupancy",
    "color": "blue",
    "role": "deduction",
    "label": "AUN Housing Occupancy",
    "key": null
  },
  {
    "col": "BZ",
    "header": "Rotary Club Fees",
    "norm": "rotary club fees",
    "color": "blue",
    "role": "deduction",
    "label": "Rotary Club Fees",
    "key": null
  },
  {
    "col": "CA",
    "header": "Charter School",
    "norm": "charter school",
    "color": "blue",
    "role": "deduction",
    "label": "Charter School",
    "key": null
  },
  {
    "col": "CB",
    "header": "Cooperative Society",
    "norm": "cooperative society",
    "color": "blue",
    "role": "deduction",
    "label": "Cooperative Society",
    "key": null
  },
  {
    "col": "CC",
    "header": "AIC",
    "norm": "aic",
    "color": "blue",
    "role": "deduction",
    "label": "AIC",
    "key": null
  },
  {
    "col": "CD",
    "header": "AUN Comm. Sch. Ded.",
    "norm": "aun comm. sch. ded.",
    "color": "blue",
    "role": "deduction",
    "label": "AUN Comm. Sch. Ded.",
    "key": null
  },
  {
    "col": "CE",
    "header": "Scholarship Funding",
    "norm": "scholarship funding",
    "color": "blue",
    "role": "deduction",
    "label": "Scholarship Funding",
    "key": null
  },
  {
    "col": "CF",
    "header": "Campus Store Deductions",
    "norm": "campus store deductions",
    "color": "blue",
    "role": "deduction",
    "label": "Campus Store Deductions",
    "key": null
  },
  {
    "col": "CG",
    "header": "Laptop Sale/Sim card/Phone",
    "norm": "laptop sale/sim card/phone",
    "color": "blue",
    "role": "deduction",
    "label": "Laptop Sale/Sim card/Phone",
    "key": null
  },
  {
    "col": "CH",
    "header": "Purchase Advance",
    "norm": "purchase advance",
    "color": "blue",
    "role": "deduction",
    "label": "Purchase Advance",
    "key": null
  },
  {
    "col": "CI",
    "header": "Atiku Centre(Chicken Sales)",
    "norm": "atiku centre(chicken sales)",
    "color": "blue",
    "role": "deduction",
    "label": "Atiku Centre(Chicken Sales)",
    "key": null
  },
  {
    "col": "CJ",
    "header": "Academy Fees",
    "norm": "academy fees",
    "color": "blue",
    "role": "deduction",
    "label": "Academy Fees",
    "key": null
  },
  {
    "col": "CK",
    "header": "University Tuition Fee",
    "norm": "university tuition fee",
    "color": "blue",
    "role": "deduction",
    "label": "University Tuition Fee",
    "key": null
  },
  {
    "col": "CL",
    "header": "Wellness Support",
    "norm": "wellness support",
    "color": "blue",
    "role": "deduction",
    "label": "Wellness Support",
    "key": null
  },
  {
    "col": "CM",
    "header": "AUN conference",
    "norm": "aun conference",
    "color": "blue",
    "role": "deduction",
    "label": "AUN conference",
    "key": null
  },
  {
    "col": "CN",
    "header": "Travels",
    "norm": "travels",
    "color": "blue",
    "role": "deduction",
    "label": "Travels",
    "key": null
  },
  {
    "col": "CO",
    "header": "Early Learning Centre Fee",
    "norm": "early learning centre fee",
    "color": "blue",
    "role": "deduction",
    "label": "Early Learning Centre Fee",
    "key": null
  },
  {
    "col": "CP",
    "header": "Inlieu of Notice",
    "norm": "inlieu of notice",
    "color": "blue",
    "role": "deduction",
    "label": "Inlieu of Notice",
    "key": null
  },
  {
    "col": "CQ",
    "header": "Salary Refunds",
    "norm": "salary refunds",
    "color": "blue",
    "role": "deduction",
    "label": "Salary Refunds",
    "key": null
  },
  {
    "col": "CR",
    "header": "Muslim Students' Society",
    "norm": "muslim students' society",
    "color": "blue",
    "role": "deduction",
    "label": "Muslim Students' Society",
    "key": null
  },
  {
    "col": "CS",
    "header": "Penalty",
    "norm": "penalty",
    "color": "blue",
    "role": "deduction",
    "label": "Penalty",
    "key": null
  },
  {
    "col": "CT",
    "header": "TOTAL DEDUCTIONS",
    "norm": "total deductions",
    "color": "green",
    "role": "total",
    "label": "Gross Deductions",
    "key": "totalDeductions"
  },
  {
    "col": "CU",
    "header": "NET PAY",
    "norm": "net pay",
    "color": "green",
    "role": "total",
    "label": "Net Pay",
    "key": "netPay"
  },
  {
    "col": "CV",
    "header": "EMPLOYER PENSION CONTRIBUTION",
    "norm": "employer pension contribution",
    "color": "red",
    "role": "internal",
    "label": "EMPLOYER PENSION CONTRIBUTION",
    "key": null
  }
];


/** Normalise a header for tolerant matching (collapse whitespace, lowercase). */
function normalizeHeader(h) {
  if (h === null || h === undefined) return '';
  return String(h).replace(/\s+/g, ' ').trim().toLowerCase();
}

// Fast lookup by normalised header name.
const BY_NORM = new Map(COLUMN_DEFS.map((c) => [c.norm, c]));

/** Mandatory identity/green fields required for a valid record. */
const REQUIRED_IDENTITY = ['employee names', 'employee id no', 'department', 'designation', 'bank', 'account no.'];

/** Column that holds the delivery email (RED / internal — never printed). */
const EMAIL_NORM = 'email address';

/** The three authoritative totals we must not silently recompute. */
const TOTAL_KEYS = { grossPay: 'gross pay', totalDeductions: 'total deductions', netPay: 'net pay' };

function classify(headerNorm) {
  return BY_NORM.get(headerNorm) || null;
}

module.exports = {
  COLUMN_DEFS,
  BY_NORM,
  REQUIRED_IDENTITY,
  EMAIL_NORM,
  TOTAL_KEYS,
  normalizeHeader,
  classify,
  // convenience groupings
  greenFields: COLUMN_DEFS.filter((c) => c.color === 'green'),
  redFields: COLUMN_DEFS.filter((c) => c.color === 'red'),
  blueEarnings: COLUMN_DEFS.filter((c) => c.color === 'blue' && c.role === 'earning'),
  blueDeductions: COLUMN_DEFS.filter((c) => c.color === 'blue' && c.role === 'deduction'),
  baseEarnings: COLUMN_DEFS.filter((c) => c.color === 'green' && c.role === 'earning'),
  baseDeductions: COLUMN_DEFS.filter((c) => c.color === 'green' && c.role === 'deduction'),
};
