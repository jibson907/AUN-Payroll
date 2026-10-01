/**
 * Secure payroll upload — .xlsx only, held in memory (never written to disk),
 * strict size/part limits, then structural ZIP checks before any parsing.
 */
const multer = require('multer');
const env = require('../config/env');
const { inspectXlsx } = require('../utils/xlsxGuard');

const ALLOWED_MIME = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/octet-stream', // some browsers/OSes send this for .xlsx
  '', // …or nothing at all
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.MAX_UPLOAD_MB * 1024 * 1024,
    files: 1,
    fields: 5,
    fieldSize: 1024,
    parts: 8,
    headerPairs: 50,
  },
  fileFilter: (req, file, cb) => {
    if (file.fieldname !== 'file') return cb(Object.assign(new Error('Unexpected upload field.'), { status: 400 }));
    const name = String(file.originalname || '').toLowerCase();
    if (!name.endsWith('.xlsx')) {
      return cb(Object.assign(new Error('Only .xlsx Excel workbooks are accepted. In Excel use File → Save As → "Excel Workbook (*.xlsx)".'), { status: 400 }));
    }
    if (!ALLOWED_MIME.includes(file.mimetype || '')) {
      return cb(Object.assign(new Error('The file does not appear to be an Excel workbook.'), { status: 400 }));
    }
    return cb(null, true);
  },
}).single('file');

const MULTER_MESSAGES = {
  LIMIT_FILE_SIZE: [413, `The file is too large. The maximum size is ${env.MAX_UPLOAD_MB} MB.`],
  LIMIT_FILE_COUNT: [400, 'Please upload one file at a time.'],
  LIMIT_UNEXPECTED_FILE: [400, 'Unexpected upload field.'],
  LIMIT_PART_COUNT: [400, 'The upload request is malformed.'],
  LIMIT_FIELD_COUNT: [400, 'The upload request is malformed.'],
  LIMIT_FIELD_VALUE: [400, 'The upload request is malformed.'],
};

/** multer + structural checks, with friendly 4xx errors (never a 500). */
function uploadSingle(req, res, next) {
  upload(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        const [status, message] = MULTER_MESSAGES[err.code] || [400, 'The upload could not be processed.'];
        return next(Object.assign(new Error(message), { status }));
      }
      return next(err.status ? err : Object.assign(new Error('The upload could not be processed.'), { status: 400 }));
    }
    if (!req.file) return next();
    try {
      req.file.xlsxInfo = inspectXlsx(req.file.buffer);
    } catch (e) {
      return next(e);
    }
    return next();
  });
}

module.exports = { uploadSingle };
