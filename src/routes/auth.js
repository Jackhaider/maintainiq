const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config/env');
const { query } = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { validate } = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { unauthorized, conflict, badRequest } = require('../utils/httpError');

const router = express.Router();
const BCRYPT_ROUNDS = 10;

const signToken = (user) =>
  jwt.sign({ sub: user.id, role: user.role }, config.jwt.secret, { expiresIn: config.jwt.expiresIn });

const publicUser = (u) => ({
  id: u.id,
  fullName: u.full_name,
  email: u.email,
  role: u.role,
  productionLineId: u.production_line_id,
});

/**
 * POST /api/auth/register
 * Self-registration always creates an OPERATOR. Supervisor accounts can only be
 * created by an existing supervisor through /api/users, so nobody can promote themselves.
 */
router.post(
  '/register',
  validate({
    fullName: { type: 'string', required: true, min: 2, max: 100 },
    email: { type: 'email', required: true },
    password: { type: 'string', required: true, min: 8, max: 72 }, // bcrypt only uses the first 72 bytes
    productionLineId: { type: 'int', required: true, min: 1 },
  }),
  asyncHandler(async (req, res) => {
    const { fullName, email, password, productionLineId } = req.body;

    const lines = await query('SELECT id FROM production_lines WHERE id = ?', [productionLineId]);
    if (!lines.length) throw badRequest('Validation failed', [{ field: 'productionLineId', message: 'Production line does not exist' }]);

    const existing = await query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length) throw conflict('An account with this email already exists');

    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const result = await query(
      `INSERT INTO users (role_id, production_line_id, full_name, email, password_hash)
       VALUES ((SELECT id FROM roles WHERE name = 'operator'), ?, ?, ?, ?)`,
      [productionLineId, fullName, email, hash]
    );

    const user = { id: result.insertId, full_name: fullName, email, role: 'operator', production_line_id: productionLineId };
    res.status(201).json({ data: { token: signToken(user), user: publicUser(user) } });
  })
);

/** POST /api/auth/login: same 401 message for unknown email and wrong password, so emails cannot be probed. */
router.post(
  '/login',
  validate({
    email: { type: 'email', required: true },
    password: { type: 'string', required: true, min: 1, max: 200 },
  }),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const rows = await query(
      `SELECT u.id, u.full_name, u.email, u.password_hash, u.production_line_id, u.is_active, r.name AS role
         FROM users u JOIN roles r ON r.id = u.role_id
        WHERE u.email = ?`,
      [email]
    );
    const user = rows[0];
    const ok = user && user.is_active && (await bcrypt.compare(password, user.password_hash));
    if (!ok) throw unauthorized('Invalid email or password');

    res.json({ data: { token: signToken(user), user: publicUser(user) } });
  })
);

/** GET /api/auth/me: who am I? Used by the frontend to restore a session. */
router.get('/me', authenticate, (req, res) => {
  res.json({ data: req.user });
});

module.exports = router;
