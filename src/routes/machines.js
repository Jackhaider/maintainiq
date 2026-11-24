const express = require('express');
const { query } = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, authorize } = require('../middleware/auth');
const { validate, validateIdParam } = require('../middleware/validate');
const { protectSeededRecord } = require('../middleware/demo');
const { notFound } = require('../utils/httpError');
const { machineScope, getAccessibleMachine } = require('../utils/scope');

const router = express.Router();
router.use(authenticate);

const STATUSES = ['running', 'idle', 'maintenance', 'down'];

const machineFields = {
  productionLineId: { type: 'int', required: true, min: 1 },
  assetTag: { type: 'string', required: true, min: 2, max: 30 },
  name: { type: 'string', required: true, min: 2, max: 100 },
  machineType: { type: 'string', required: true, min: 2, max: 50 },
  manufacturer: { type: 'string', max: 100, nullable: true },
  ratedPowerKw: { type: 'number', required: true, min: 0.01, max: 100000 },
  status: { type: 'enum', values: STATUSES },
  installedOn: { type: 'date', nullable: true },
};

const COLUMNS = {
  productionLineId: 'production_line_id',
  assetTag: 'asset_tag',
  name: 'name',
  machineType: 'machine_type',
  manufacturer: 'manufacturer',
  ratedPowerKw: 'rated_power_kw',
  status: 'status',
  installedOn: 'installed_on',
};

// JOIN machines -> production_lines, plus a correlated subquery counting unfinished work orders.
const SELECT_MACHINE = `
  SELECT m.id, m.asset_tag, m.name, m.machine_type, m.manufacturer, m.rated_power_kw, m.status,
         m.installed_on, m.production_line_id, pl.name AS production_line, pl.code AS production_line_code,
         (SELECT COUNT(*) FROM work_orders wo WHERE wo.machine_id = m.id AND wo.status <> 'closed') AS open_work_orders,
         m.created_at, m.updated_at
    FROM machines m
    JOIN production_lines pl ON pl.id = m.production_line_id`;

/** GET /api/machines?status=&lineId=&search= */
router.get(
  '/',
  validate(
    {
      status: { type: 'enum', values: STATUSES },
      lineId: { type: 'int', min: 1 },
      search: { type: 'string', max: 100 },
    },
    { source: 'query' }
  ),
  asyncHandler(async (req, res) => {
    const scope = machineScope(req.user);
    const where = [scope.clause];
    const params = [...scope.params];
    const { status, lineId, search } = req.validQuery;
    if (status) { where.push('m.status = ?'); params.push(status); }
    if (lineId) { where.push('m.production_line_id = ?'); params.push(lineId); }
    if (search) {
      where.push('(m.name LIKE ? OR m.asset_tag LIKE ? OR m.machine_type LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    const rows = await query(`${SELECT_MACHINE} WHERE ${where.join(' AND ')} ORDER BY m.asset_tag`, params);
    res.json({ data: rows, meta: { count: rows.length } });
  })
);

/** GET /api/machines/:id */
router.get(
  '/:id',
  validateIdParam('id'),
  asyncHandler(async (req, res) => {
    await getAccessibleMachine(req.user, req.params.id);
    const rows = await query(`${SELECT_MACHINE} WHERE m.id = ?`, [req.params.id]);
    res.json({ data: rows[0] });
  })
);

/** POST /api/machines (supervisor) */
router.post(
  '/',
  authorize('supervisor'),
  validate(machineFields),
  asyncHandler(async (req, res) => {
    const keys = Object.keys(req.body);
    const result = await query(
      `INSERT INTO machines (${keys.map((k) => COLUMNS[k]).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
      keys.map((k) => req.body[k])
    );
    const rows = await query(`${SELECT_MACHINE} WHERE m.id = ?`, [result.insertId]);
    res.status(201).json({ data: rows[0] });
  })
);

/** PATCH /api/machines/:id (supervisor): update any subset of fields */
router.patch(
  '/:id',
  authorize('supervisor'),
  validateIdParam('id'),
  validate(machineFields, { partial: true }),
  asyncHandler(async (req, res) => {
    const keys = Object.keys(req.body);
    const result = await query(
      `UPDATE machines SET ${keys.map((k) => `${COLUMNS[k]} = ?`).join(', ')} WHERE id = ?`,
      [...keys.map((k) => req.body[k]), req.params.id]
    );
    if (result.affectedRows === 0) throw notFound('Machine');
    const rows = await query(`${SELECT_MACHINE} WHERE m.id = ?`, [req.params.id]);
    res.json({ data: rows[0] });
  })
);

/** PATCH /api/machines/:id/status: operators may change the status of machines on their own line */
router.patch(
  '/:id/status',
  validateIdParam('id'),
  validate({ status: { type: 'enum', values: STATUSES, required: true } }),
  asyncHandler(async (req, res) => {
    await getAccessibleMachine(req.user, req.params.id);
    await query('UPDATE machines SET status = ? WHERE id = ?', [req.body.status, req.params.id]);
    const rows = await query(`${SELECT_MACHINE} WHERE m.id = ?`, [req.params.id]);
    res.json({ data: rows[0] });
  })
);

/** DELETE /api/machines/:id (supervisor). Refused with 409 while history (work orders, downtime, energy) exists. */
router.delete(
  '/:id',
  authorize('supervisor'),
  validateIdParam('id'),
  protectSeededRecord('machines', 'machine'),
  asyncHandler(async (req, res) => {
    const result = await query('DELETE FROM machines WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) throw notFound('Machine');
    res.status(204).end();
  })
);

module.exports = router;
