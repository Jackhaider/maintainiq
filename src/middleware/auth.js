const jwt = require('jsonwebtoken');
const config = require('../config/env');
const { query } = require('../config/db');
const { unauthorized, forbidden } = require('../utils/httpError');

/**
 * Verify the Bearer token and load the current user.
 * The user is re-read from the database so a deactivated account or a role change takes effect immediately.
 * Missing or invalid token -> 401.
 */
async function authenticate(req, res, next) {
  try {
    const header = req.get('Authorization') || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) throw unauthorized();

    let payload;
    try {
      payload = jwt.verify(token, config.jwt.secret);
    } catch (err) {
      throw unauthorized(err.name === 'TokenExpiredError' ? 'Session expired, please log in again' : 'Invalid token');
    }

    const rows = await query(
      `SELECT u.id, u.full_name, u.email, u.production_line_id, u.is_active, r.name AS role
         FROM users u JOIN roles r ON r.id = u.role_id
        WHERE u.id = ?`,
      [payload.sub]
    );
    const user = rows[0];
    if (!user || !user.is_active) throw unauthorized('Account not found or disabled');

    req.user = {
      id: user.id,
      fullName: user.full_name,
      email: user.email,
      role: user.role,
      productionLineId: user.production_line_id,
    };
    next();
  } catch (err) {
    next(err);
  }
}

/** Allow only the listed roles. Logged in but wrong role -> 403. */
function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}

const isSupervisor = (user) => user.role === 'supervisor';

module.exports = { authenticate, authorize, isSupervisor };
