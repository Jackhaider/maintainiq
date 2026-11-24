const config = require('../config/env');
const { HttpError } = require('../utils/httpError');

// MySQL error codes we can translate into a useful client response.
const MYSQL_ERRORS = {
  ER_DUP_ENTRY: [409, 'CONFLICT', 'A record with this value already exists'],
  ER_NO_REFERENCED_ROW_2: [400, 'VALIDATION_ERROR', 'A referenced record does not exist'],
  ER_ROW_IS_REFERENCED_2: [409, 'CONFLICT', 'This record is still referenced by other records'],
  ER_CHECK_CONSTRAINT_VIOLATED: [400, 'VALIDATION_ERROR', 'A value breaks a database rule'],
};

function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.originalUrl} not found` } });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Malformed JSON body from express.json()
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' } });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' } });
  }

  if (err instanceof HttpError) {
    const body = { code: err.code, message: err.message };
    if (err.details) body.details = err.details;
    return res.status(err.status).json({ error: body });
  }

  if (err.code && MYSQL_ERRORS[err.code]) {
    const [status, code, message] = MYSQL_ERRORS[err.code];
    return res.status(status).json({ error: { code, message } });
  }

  // Anything else is a bug or an infrastructure failure: log the full error on the server,
  // but never send stack traces or SQL to the client in production.
  if (!config.isTest) {
    console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ->`, err);
  }
  const message = config.isProduction ? 'Something went wrong on our side' : err.message;
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message } });
}

module.exports = { notFoundHandler, errorHandler };
