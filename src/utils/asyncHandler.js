/** Wrap an async route so a rejected promise reaches the error handler instead of crashing the request. */
module.exports = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
