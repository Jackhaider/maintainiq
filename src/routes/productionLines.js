const express = require('express');
const { query } = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, authorize } = require('../middleware/auth');
const { validate, validateIdParam } = require('../middleware/validate');
const { notFound } = require('../utils/httpError');

const router = express.Router();
router.use(authenticate);

// LEFT JOIN + GROUP BY: every line with its machine counts, including lines that have no machines yet.
const SELECT_LINE = `
  SELECT pl.id, pl.code, pl.name, pl.location, pl.created_at, pl.updated_at,
         COUNT(m.id)                                AS machine_count,
         COALESCE(SUM(m.status = 'running'), 0)     AS running,
         COALESCE(SUM(m.status IN ('down','maintenance')), 0) AS unavailable,
         COALESCE(SUM(m.rated_power_kw), 0)         AS installed_power_kw
    FROM production_lines pl
    LEFT JOIN machines m ON m.production_line_id = pl.id`;
const GROUP = 'GROUP BY pl.id, pl.code, pl.name, pl.location, pl.created_at, pl.updated_at';

const fields = {
  code: { type: 'string', required: true, min: 2, max: 20 },
  name: { type: 'string', required: true, min: 2, max: 100 },
  location: { type: 'string', required: true, min: 2, max: 100 },
};

/** GET /api/production-lines: both roles (the registration form also needs the list, see /public) */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = await query(`${SELECT_LINE} ${GROUP} ORDER BY pl.code`);
    res.json({ data: rows, meta: { count: rows.length } });
  })
);

router.get(
  '/:id',
  validateIdParam('id'),
  asyncHandler(async (req, res) => {
    const rows = await query(`${SELECT_LINE} WHERE pl.id = ? ${GROUP}`, [req.params.id]);
    if (!rows.length) throw notFound('Production line');
    res.json({ data: rows[0] });
  })
);

router.post(
  '/',
  authorize('supervisor'),
  validate(fields),
  asyncHandler(async (req, res) => {
    const { code, name, location } = req.body;
    const result = await query('INSERT INTO production_lines (code, name, location) VALUES (?, ?, ?)', [code.toUpperCase(), name, location]);
    const rows = await query(`${SELECT_LINE} WHERE pl.id = ? ${GROUP}`, [result.insertId]);
    res.status(201).json({ data: rows[0] });
  })
);

router.patch(
  '/:id',
  authorize('supervisor'),
  validateIdParam('id'),
  validate(fields, { partial: true }),
  asyncHandler(async (req, res) => {
    if (req.body.code) req.body.code = req.body.code.toUpperCase();
    const keys = Object.keys(req.body); // keys are limited to code/name/location by validate()
    const result = await query(`UPDATE production_lines SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [
      ...keys.map((k) => req.body[k]),
      req.params.id,
    ]);
    if (result.affectedRows === 0) throw notFound('Production line');
    const rows = await query(`${SELECT_LINE} WHERE pl.id = ? ${GROUP}`, [req.params.id]);
    res.json({ data: rows[0] });
  })
);

/** DELETE: refused with 409 by the foreign key while machines still belong to the line */
router.delete(
  '/:id',
  authorize('supervisor'),
  validateIdParam('id'),
  asyncHandler(async (req, res) => {
    const result = await query('DELETE FROM production_lines WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) throw notFound('Production line');
    res.status(204).end();
  })
);

module.exports = router;
