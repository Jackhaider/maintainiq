/** An error that carries an HTTP status, a machine-readable code and optional details. */
class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const badRequest = (message, details) => new HttpError(400, 'VALIDATION_ERROR', message, details);
const unauthorized = (message = 'Authentication required') => new HttpError(401, 'UNAUTHORIZED', message);
const forbidden = (message = 'You do not have permission to do this') => new HttpError(403, 'FORBIDDEN', message);
const notFound = (what = 'Resource') => new HttpError(404, 'NOT_FOUND', `${what} not found`);
const conflict = (message) => new HttpError(409, 'CONFLICT', message);

module.exports = { HttpError, badRequest, unauthorized, forbidden, notFound, conflict };
