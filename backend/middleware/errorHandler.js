/** Central error handler — never leaks stack traces to clients. */
const logger = require('../utils/logger');
const { redact } = require('../config/mongo');

// Mongoose errors → safe client messages (never echo values or internals).
function normalise(err) {
  if (err.name === 'CastError') return Object.assign(err, { status: 400, message: 'Invalid identifier.' });
  if (err.name === 'ValidationError') return Object.assign(err, { status: 400, message: 'Some submitted values are invalid.' });
  // database unreachable (network / Atlas IP allow-list) → 503, not a vague 500
  if (/^Mongo(ServerSelection|Network|NotConnected)Error$/.test(err.name) || /ETIMEDOUT .*:27017|ECONNREFUSED .*:27017/.test(err.message)) {
    return Object.assign(err, { status: 503, expose: true, message: 'The payroll database is not reachable right now. Please try again shortly or contact IT support.' });
  }
  return err;
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  normalise(err);
  const status = err.status || err.statusCode || 500;
  // 4xx messages are written for users; 5xx only when explicitly marked safe
  const isClient = (status >= 400 && status < 500) || err.expose === true;
  logger.error('request_error', {
    path: req.path,
    method: req.method,
    status,
    message: redact(err.message),
    stack: status >= 500 ? redact(err.stack) : undefined,
  });
  res.status(status).json({
    error: isClient && err.message ? err.message : 'Something went wrong. Please try again or contact IT support.',
  });
}

function notFound(req, res) {
  res.status(404).json({ error: 'Resource not found.' });
}

module.exports = { errorHandler, notFound };
