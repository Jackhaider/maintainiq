const express = require('express');
const { query, pool } = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, authorize, isSupervisor } = require('../middleware/auth');
const { validate, validateIdParam } = require('../middleware/validate');
const { protectSeededRecord } = require('../middleware/demo');
const { notFound, forbidden, conflict, badRequest } = require('../utils/httpError');
const { machineScope, getAccessibleMachine } = require('../utils/scope');

const router = express.Router();
router.use(authenticate);

const TYPES = ['corrective', 'preventive', 'inspection'];
const PRIORITIES = ['low', 'medium', 'high', 'critical'];
const STATUSES = ['open', 'assigned', 'in_progress', 'closed'];

// Four-table JOIN: work order + machine + production line + requester, LEFT JOIN for the optional assignee.
const SELECT_WORK_ORDER = `
  SELECT wo.id, wo.title, wo.description, wo.order_type, wo.priority, wo.status, wo.due_date, wo.closed_at,
         wo.created_at, wo.updated_at,
         wo.machine_id, m.name AS machine_name, m.asset_tag, m.production_line_id, pl.name AS production_line,
         wo.requested_by, req.full_name AS requested_by_name,
         wo.assigned_to, asg.full_name AS assigned_to_name
    FROM work_orders wo
    JOIN machines m          ON m.id = wo.machine_id
    JOIN production_lines pl ON pl.id = m.production_line_id
    JOIN users req           ON req.id = wo.requested_by
    LEFT JOIN users asg      ON asg.id = wo.assigned_to`;

const SELECT_NOTES = `
  SELECT n.id, n.work_order_id, n.note, n.created_at, n.author_id, u.full_name AS author_name
    FROM maintenance_notes n JOIN users u ON u.id = n.author_id`;

/** Load a work order the user may see, or throw 404/403. */
async function getAccessibleWorkOrder(user, id) {
  const rows = await query(`${SELECT_WORK_ORDER} WHERE wo.id = ?`, [id]);
  const wo = rows[0];
  if (!wo) throw notFound('Work order');
  if (!isSupervisor(user) && wo.production_line_id !== user.productionLineId) {
    throw forbidden('This work order belongs to another production line');
  }
  return wo;
}

async function assertAssignableUser(userId) {
  const rows = await query('SELECT id FROM users WHERE id = ? AND is_active = TRUE', [userId]);
  if (!rows.length) {
    throw badRequest('Validation failed', [{ field: 'assignedTo', message: 'User does not exist or is inactive' }]);
  }
}

/** GET /api/work-orders?status=&priority=&machineId=&mine=true */
router.get(
  '/',
  validate(
    {
      status: { type: 'enum', values: STATUSES },
      priority: { type: 'enum', values: PRIORITIES },
      machineId: { type: 'int', min: 1 },
      mine: { type: 'enum', values: ['true', 'false'] },
    },
    { source: 'query' }
  ),
  asyncHandler(async (req, res) => {
    const scope = machineScope(req.user);
    const where = [scope.clause];
    const params = [...scope.params];
    const { status, priority, machineId, mine } = req.validQuery;
    if (status) { where.push('wo.status = ?'); params.push(status); }
    if (priority) { where.push('wo.priority = ?'); params.push(priority); }
    if (machineId) { where.push('wo.machine_id = ?'); params.push(machineId); }
    if (mine === 'true') {
      where.push('(wo.assigned_to = ? OR wo.requested_by = ?)');
      params.push(req.user.id, req.user.id);
    }

    const rows = await query(
      `${SELECT_WORK_ORDER} WHERE ${where.join(' AND ')}
       ORDER BY wo.status = 'closed', FIELD(wo.priority, 'critical', 'high', 'medium', 'low'), wo.created_at DESC`,
      params
    );
    res.json({ data: rows, meta: { count: rows.length } });
  })
);

/** GET /api/work-orders/:id: includes its maintenance notes */
router.get(
  '/:id',
  validateIdParam('id'),
  asyncHandler(async (req, res) => {
    const wo = await getAccessibleWorkOrder(req.user, req.params.id);
    const notes = await query(`${SELECT_NOTES} WHERE n.work_order_id = ? ORDER BY n.created_at, n.id`, [wo.id]);
    res.json({ data: { ...wo, notes } });
  })
);

/**
 * POST /api/work-orders: operators raise maintenance requests for machines on their own line.
 * Only supervisors may assign someone at creation time.
 */
router.post(
  '/',
  validate({
    machineId: { type: 'int', required: true, min: 1 },
    title: { type: 'string', required: true, min: 3, max: 150 },
    description: { type: 'string', max: 5000, nullable: true },
    orderType: { type: 'enum', values: TYPES },
    priority: { type: 'enum', values: PRIORITIES },
    dueDate: { type: 'date', nullable: true },
    assignedTo: { type: 'int', min: 1 },
  }),
  asyncHandler(async (req, res) => {
    const b = req.body;
    await getAccessibleMachine(req.user, b.machineId);
    if (b.assignedTo !== undefined) {
      if (!isSupervisor(req.user)) throw forbidden('Only supervisors can assign work orders');
      await assertAssignableUser(b.assignedTo);
    }

    const result = await query(
      `INSERT INTO work_orders
         (machine_id, requested_by, assigned_to, title, description, order_type, priority, status, due_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        b.machineId,
        req.user.id,
        b.assignedTo ?? null,
        b.title,
        b.description ?? null,
        b.orderType || 'corrective',
        b.priority || 'medium',
        b.assignedTo ? 'assigned' : 'open',
        b.dueDate ?? null,
      ]
    );
    res.status(201).json({ data: await getAccessibleWorkOrder(req.user, result.insertId) });
  })
);

/** PATCH /api/work-orders/:id (supervisor): edit details */
router.patch(
  '/:id',
  authorize('supervisor'),
  validateIdParam('id'),
  validate(
    {
      title: { type: 'string', min: 3, max: 150 },
      description: { type: 'string', max: 5000, nullable: true },
      orderType: { type: 'enum', values: TYPES },
      priority: { type: 'enum', values: PRIORITIES },
      dueDate: { type: 'date', nullable: true },
    },
    { partial: true }
  ),
  asyncHandler(async (req, res) => {
    const cols = { title: 'title', description: 'description', orderType: 'order_type', priority: 'priority', dueDate: 'due_date' };
    const keys = Object.keys(req.body);
    const result = await query(
      `UPDATE work_orders SET ${keys.map((k) => `${cols[k]} = ?`).join(', ')} WHERE id = ?`,
      [...keys.map((k) => req.body[k]), req.params.id]
    );
    if (result.affectedRows === 0) throw notFound('Work order');
    res.json({ data: await getAccessibleWorkOrder(req.user, req.params.id) });
  })
);

/** POST /api/work-orders/:id/assign (supervisor) */
router.post(
  '/:id/assign',
  authorize('supervisor'),
  validateIdParam('id'),
  validate({ assignedTo: { type: 'int', required: true, min: 1 } }),
  asyncHandler(async (req, res) => {
    const wo = await getAccessibleWorkOrder(req.user, req.params.id);
    if (wo.status === 'closed') throw conflict('Closed work orders cannot be reassigned');
    await assertAssignableUser(req.body.assignedTo);
    await query(
      `UPDATE work_orders SET assigned_to = ?, status = IF(status = 'open', 'assigned', status) WHERE id = ?`,
      [req.body.assignedTo, wo.id]
    );
    res.json({ data: await getAccessibleWorkOrder(req.user, wo.id) });
  })
);

/** POST /api/work-orders/:id/start: the assignee (or a supervisor) starts work */
router.post(
  '/:id/start',
  validateIdParam('id'),
  asyncHandler(async (req, res) => {
    const wo = await getAccessibleWorkOrder(req.user, req.params.id);
    if (!isSupervisor(req.user) && wo.assigned_to !== req.user.id) {
      throw forbidden('Only the assigned person or a supervisor can start this work order');
    }
    if (wo.status === 'closed') throw conflict('Work order is already closed');
    await query(`UPDATE work_orders SET status = 'in_progress' WHERE id = ?`, [wo.id]);
    res.json({ data: await getAccessibleWorkOrder(req.user, wo.id) });
  })
);

/**
 * POST /api/work-orders/:id/close (supervisor)
 * Closing and writing the resolution note happen in one transaction, so neither can exist without the other.
 */
router.post(
  '/:id/close',
  authorize('supervisor'),
  validateIdParam('id'),
  validate({ resolution: { type: 'string', min: 3, max: 5000 } }),
  asyncHandler(async (req, res) => {
    const wo = await getAccessibleWorkOrder(req.user, req.params.id);
    if (wo.status === 'closed') throw conflict('Work order is already closed');

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(`UPDATE work_orders SET status = 'closed', closed_at = NOW() WHERE id = ?`, [wo.id]);
      if (req.body.resolution) {
        await conn.execute('INSERT INTO maintenance_notes (work_order_id, author_id, note) VALUES (?, ?, ?)', [
          wo.id,
          req.user.id,
          `Closed: ${req.body.resolution}`,
        ]);
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
    res.json({ data: await getAccessibleWorkOrder(req.user, wo.id) });
  })
);

/** DELETE /api/work-orders/:id (supervisor). Its notes are removed by ON DELETE CASCADE. */
router.delete(
  '/:id',
  authorize('supervisor'),
  validateIdParam('id'),
  protectSeededRecord('work_orders', 'work order'),
  asyncHandler(async (req, res) => {
    const result = await query('DELETE FROM work_orders WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) throw notFound('Work order');
    res.status(204).end();
  })
);

/** GET /api/work-orders/:id/notes */
router.get(
  '/:id/notes',
  validateIdParam('id'),
  asyncHandler(async (req, res) => {
    const wo = await getAccessibleWorkOrder(req.user, req.params.id);
    const notes = await query(`${SELECT_NOTES} WHERE n.work_order_id = ? ORDER BY n.created_at, n.id`, [wo.id]);
    res.json({ data: notes, meta: { count: notes.length } });
  })
);

/** POST /api/work-orders/:id/notes: anyone who can see the work order can add a note while it is open */
router.post(
  '/:id/notes',
  validateIdParam('id'),
  validate({ note: { type: 'string', required: true, min: 2, max: 5000 } }),
  asyncHandler(async (req, res) => {
    const wo = await getAccessibleWorkOrder(req.user, req.params.id);
    if (wo.status === 'closed' && !isSupervisor(req.user)) throw conflict('Work order is closed');
    const result = await query('INSERT INTO maintenance_notes (work_order_id, author_id, note) VALUES (?, ?, ?)', [
      wo.id,
      req.user.id,
      req.body.note,
    ]);
    const rows = await query(`${SELECT_NOTES} WHERE n.id = ?`, [result.insertId]);
    res.status(201).json({ data: rows[0] });
  })
);

module.exports = router;
