const express = require('express');
const { query } = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, authorize, isSupervisor } = require('../middleware/auth');
const { validate, validateIdParam } = require('../middleware/validate');
const { protectSeededRecord } = require('../middleware/demo');
const { notFound, forbidden, conflict, badRequest } = require('../utils/httpError');
const { machineScope, getAccessibleMachine } = require('../utils/scope');

const router = express.Router();
router.use(authenticate);

const REASONS = ['mechanical', 'electrical', 'material', 'changeover', 'other'];

// Duration is calculated, not stored, so it can never disagree with the start/end times.
// Ongoing stoppages (ended_at IS NULL) count up to the current time.
const SELECT_DOWNTIME = `
  SELECT d.id, d.machine_id, m.name AS machine_name, m.asset_tag, m.production_line_id, pl.name AS production_line,
         d.work_order_id, d.reason_category, d.description, d.started_at, d.ended_at,
         TIMESTAMPDIFF(MINUTE, d.started_at, COALESCE(d.ended_at, NOW())) AS duration_minutes,
         d.reported_by, u.full_name AS reported_by_name, d.created_at
    FROM downtime_logs d
    JOIN machines m          ON m.id = d.machine_id
    JOIN production_lines pl ON pl.id = m.production_line_id
    JOIN users u             ON u.id = d.reported_by`;

async function getAccessibleDowntime(user, id) {
  const rows = await query(`${SELECT_DOWNTIME} WHERE d.id = ?`, [id]);
  const log = rows[0];
  if (!log) throw notFound('Downtime log');
  if (!isSupervisor(user) && log.production_line_id !== user.productionLineId) {
    throw forbidden('This downtime log belongs to another production line');
  }
  return log;
}

/** GET /api/downtime?machineId=&from=&to=&ongoing=true&limit= */
router.get(
  '/',
  validate(
    {
      machineId: { type: 'int', min: 1 },
      from: { type: 'date' },
      to: { type: 'date' },
      ongoing: { type: 'enum', values: ['true', 'false'] },
      limit: { type: 'int', min: 1, max: 500 },
    },
    { source: 'query' }
  ),
  asyncHandler(async (req, res) => {
    const scope = machineScope(req.user);
    const where = [scope.clause];
    const params = [...scope.params];
    const q = req.validQuery;
    if (q.machineId) { where.push('d.machine_id = ?'); params.push(q.machineId); }
    if (q.from) { where.push('d.started_at >= ?'); params.push(q.from); }
    if (q.to) { where.push('d.started_at < ? + INTERVAL 1 DAY'); params.push(q.to); }
    if (q.ongoing === 'true') where.push('d.ended_at IS NULL');
    const limit = q.limit || 200; // validated integer, safe to inline

    const rows = await query(
      `${SELECT_DOWNTIME} WHERE ${where.join(' AND ')} ORDER BY d.started_at DESC LIMIT ${limit}`,
      params
    );
    res.json({ data: rows, meta: { count: rows.length } });
  })
);

/** GET /api/downtime/:id */
router.get(
  '/:id',
  validateIdParam('id'),
  asyncHandler(async (req, res) => {
    res.json({ data: await getAccessibleDowntime(req.user, req.params.id) });
  })
);

/** POST /api/downtime: record a stoppage on a machine the user can access */
router.post(
  '/',
  validate({
    machineId: { type: 'int', required: true, min: 1 },
    reasonCategory: { type: 'enum', values: REASONS, required: true },
    description: { type: 'string', max: 500, nullable: true },
    startedAt: { type: 'datetime', required: true },
    endedAt: { type: 'datetime', nullable: true },
    workOrderId: { type: 'int', min: 1, nullable: true },
  }),
  asyncHandler(async (req, res) => {
    const b = req.body;
    await getAccessibleMachine(req.user, b.machineId);
    if (b.endedAt && b.endedAt <= b.startedAt) {
      throw badRequest('Validation failed', [{ field: 'endedAt', message: 'endedAt must be after startedAt' }]);
    }
    if (b.workOrderId) {
      const wo = await query('SELECT machine_id FROM work_orders WHERE id = ?', [b.workOrderId]);
      if (!wo.length || wo[0].machine_id !== b.machineId) {
        throw badRequest('Validation failed', [{ field: 'workOrderId', message: 'Work order does not exist for this machine' }]);
      }
    }
    const result = await query(
      `INSERT INTO downtime_logs (machine_id, work_order_id, reported_by, reason_category, description, started_at, ended_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [b.machineId, b.workOrderId ?? null, req.user.id, b.reasonCategory, b.description ?? null, b.startedAt, b.endedAt ?? null]
    );
    res.status(201).json({ data: await getAccessibleDowntime(req.user, result.insertId) });
  })
);

/** PATCH /api/downtime/:id/end: mark an ongoing stoppage as finished (reporter or supervisor) */
router.patch(
  '/:id/end',
  validateIdParam('id'),
  validate({ endedAt: { type: 'datetime' } }),
  asyncHandler(async (req, res) => {
    const log = await getAccessibleDowntime(req.user, req.params.id);
    if (!isSupervisor(req.user) && log.reported_by !== req.user.id) {
      throw forbidden('Only the person who reported this stoppage or a supervisor can end it');
    }
    if (log.ended_at) throw conflict('This stoppage has already ended');
    if (req.body.endedAt && req.body.endedAt <= log.started_at) {
      throw badRequest('Validation failed', [{ field: 'endedAt', message: 'endedAt must be after startedAt' }]);
    }
    await query('UPDATE downtime_logs SET ended_at = COALESCE(?, NOW()) WHERE id = ?', [req.body.endedAt ?? null, log.id]);
    res.json({ data: await getAccessibleDowntime(req.user, log.id) });
  })
);

/** DELETE /api/downtime/:id (supervisor) */
router.delete(
  '/:id',
  authorize('supervisor'),
  validateIdParam('id'),
  protectSeededRecord('downtime_logs', 'downtime log'),
  asyncHandler(async (req, res) => {
    const result = await query('DELETE FROM downtime_logs WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) throw notFound('Downtime log');
    res.status(204).end();
  })
);

module.exports = router;
