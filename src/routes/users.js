const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, authorize } = require('../middleware/auth');
const { validate, validateIdParam } = require('../middleware/validate');
const { protectDemoAccount, assertNotReservedEmail } = require('../middleware/demo');
const { notFound, conflict, badRequest } = require('../utils/httpError');

/* User management is supervisor-only. Users are deactivated, never deleted, so their history stays intact. */

const router = express.Router();
router.use(authenticate, authorize('supervisor'));

const SELECT_USER = `
  SELECT u.id, u.full_name, u.email, r.name AS role, u.production_line_id, pl.name AS production_line,
         u.is_active, u.created_at, u.updated_at
    FROM users u
    JOIN roles r ON r.id = u.role_id
    LEFT JOIN production_lines pl ON pl.id = u.production_line_id`;

async function roleId(name) {
  const rows = await query('SELECT id FROM roles WHERE name = ?', [name]);
  return rows[0].id;
}

/** Operators must belong to a line; supervisors cover every line. */
function checkLineRule(role, productionLineId) {
  if (role === 'operator' && !productionLineId) {
    throw badRequest('Validation failed', [{ field: 'productionLineId', message: 'Operators must be assigned to a production line' }]);
  }
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = await query(`${SELECT_USER} ORDER BY u.is_active DESC, r.name DESC, u.full_name`);
    res.json({ data: rows, meta: { count: rows.length } });
  })
);

router.get(
  '/:id',
  validateIdParam('id'),
  asyncHandler(async (req, res) => {
    const rows = await query(`${SELECT_USER} WHERE u.id = ?`, [req.params.id]);
    if (!rows.length) throw notFound('User');
    res.json({ data: rows[0] });
  })
);

router.post(
  '/',
  validate({
    fullName: { type: 'string', required: true, min: 2, max: 100 },
    email: { type: 'email', required: true },
    password: { type: 'string', required: true, min: 8, max: 72 },
    role: { type: 'enum', values: ['operator', 'supervisor'], required: true },
    productionLineId: { type: 'int', min: 1, nullable: true },
  }),
  asyncHandler(async (req, res) => {
    const b = req.body;
    checkLineRule(b.role, b.productionLineId);
    assertNotReservedEmail(b.email);
    const existing = await query('SELECT id FROM users WHERE email = ?', [b.email]);
    if (existing.length) throw conflict('An account with this email already exists');

    const hash = await bcrypt.hash(b.password, 10);
    const result = await query(
      'INSERT INTO users (role_id, production_line_id, full_name, email, password_hash) VALUES (?, ?, ?, ?, ?)',
      [await roleId(b.role), b.role === 'supervisor' ? null : b.productionLineId, b.fullName, b.email, hash]
    );
    const rows = await query(`${SELECT_USER} WHERE u.id = ?`, [result.insertId]);
    res.status(201).json({ data: rows[0] });
  })
);

router.patch(
  '/:id',
  validateIdParam('id'),
  validate(
    {
      fullName: { type: 'string', min: 2, max: 100 },
      role: { type: 'enum', values: ['operator', 'supervisor'] },
      productionLineId: { type: 'int', min: 1, nullable: true },
      isActive: { type: 'boolean' },
    },
    { partial: true }
  ),
  protectDemoAccount,
  asyncHandler(async (req, res) => {
    const current = (await query(`${SELECT_USER} WHERE u.id = ?`, [req.params.id]))[0];
    if (!current) throw notFound('User');

    const b = req.body;
    if (req.params.id === req.user.id && (b.isActive === false || b.role === 'operator')) {
      throw conflict('You cannot deactivate or demote your own account');
    }

    const role = b.role || current.role;
    let lineId = b.productionLineId !== undefined ? b.productionLineId : current.production_line_id;
    if (role === 'supervisor') lineId = null;
    checkLineRule(role, lineId);

    await query(
      `UPDATE users SET full_name = ?, role_id = ?, production_line_id = ?, is_active = ? WHERE id = ?`,
      [b.fullName ?? current.full_name, await roleId(role), lineId, b.isActive ?? Boolean(current.is_active), req.params.id]
    );
    const rows = await query(`${SELECT_USER} WHERE u.id = ?`, [req.params.id]);
    res.json({ data: rows[0] });
  })
);

module.exports = router;
