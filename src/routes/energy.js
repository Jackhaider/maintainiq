const express = require('express');
const { query } = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, authorize } = require('../middleware/auth');
const { validate, validateIdParam } = require('../middleware/validate');
const { protectSeededRecord } = require('../middleware/demo');
const { notFound, badRequest } = require('../utils/httpError');
const { machineScope, getAccessibleMachine } = require('../utils/scope');

const router = express.Router();
router.use(authenticate);

const SELECT_READING = `
  SELECT e.id, e.machine_id, m.name AS machine_name, m.asset_tag, m.production_line_id, pl.name AS production_line,
         e.reading_date, e.kwh, e.recorded_by, u.full_name AS recorded_by_name, e.created_at
    FROM energy_readings e
    JOIN machines m          ON m.id = e.machine_id
    JOIN production_lines pl ON pl.id = m.production_line_id
    JOIN users u             ON u.id = e.recorded_by`;

/** GET /api/energy?machineId=&from=&to=&limit= */
router.get(
  '/',
  validate(
    {
      machineId: { type: 'int', min: 1 },
      from: { type: 'date' },
      to: { type: 'date' },
      limit: { type: 'int', min: 1, max: 1000 },
    },
    { source: 'query' }
  ),
  asyncHandler(async (req, res) => {
    const scope = machineScope(req.user);
    const where = [scope.clause];
    const params = [...scope.params];
    const q = req.validQuery;
    if (q.machineId) { where.push('e.machine_id = ?'); params.push(q.machineId); }
    if (q.from) { where.push('e.reading_date >= ?'); params.push(q.from); }
    if (q.to) { where.push('e.reading_date <= ?'); params.push(q.to); }
    const limit = q.limit || 200; // validated integer, safe to inline

    const rows = await query(
      `${SELECT_READING} WHERE ${where.join(' AND ')} ORDER BY e.reading_date DESC, m.asset_tag LIMIT ${limit}`,
      params
    );
    res.json({ data: rows, meta: { count: rows.length } });
  })
);

/** GET /api/energy/daily?days=30: total kWh per day (GROUP BY) for the trend chart */
router.get(
  '/daily',
  validate({ days: { type: 'int', min: 1, max: 366 } }, { source: 'query' }),
  asyncHandler(async (req, res) => {
    const scope = machineScope(req.user);
    const days = req.validQuery.days || 30;
    const rows = await query(
      `SELECT e.reading_date, ROUND(SUM(e.kwh), 2) AS total_kwh, COUNT(*) AS readings
         FROM energy_readings e JOIN machines m ON m.id = e.machine_id
        WHERE ${scope.clause} AND e.reading_date > CURDATE() - INTERVAL ? DAY
        GROUP BY e.reading_date
        ORDER BY e.reading_date`,
      [...scope.params, days]
    );
    res.json({ data: rows, meta: { count: rows.length, days } });
  })
);

/** POST /api/energy: one reading per machine per day (a duplicate returns 409) */
router.post(
  '/',
  validate({
    machineId: { type: 'int', required: true, min: 1 },
    readingDate: { type: 'date', required: true },
    kwh: { type: 'number', required: true, min: 0, max: 1000000 },
  }),
  asyncHandler(async (req, res) => {
    const b = req.body;
    await getAccessibleMachine(req.user, b.machineId);
    // Compare with the server's local calendar date (toISOString alone would use UTC).
    const now = new Date();
    const today = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    if (b.readingDate > today) {
      throw badRequest('Validation failed', [{ field: 'readingDate', message: 'readingDate cannot be in the future' }]);
    }
    const result = await query(
      'INSERT INTO energy_readings (machine_id, recorded_by, reading_date, kwh) VALUES (?, ?, ?, ?)',
      [b.machineId, req.user.id, b.readingDate, b.kwh]
    );
    const rows = await query(`${SELECT_READING} WHERE e.id = ?`, [result.insertId]);
    res.status(201).json({ data: rows[0] });
  })
);

/** DELETE /api/energy/:id (supervisor): remove a wrong reading */
router.delete(
  '/:id',
  authorize('supervisor'),
  validateIdParam('id'),
  protectSeededRecord('energy_readings', 'energy reading'),
  asyncHandler(async (req, res) => {
    const result = await query('DELETE FROM energy_readings WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) throw notFound('Energy reading');
    res.status(204).end();
  })
);

module.exports = router;
