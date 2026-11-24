const express = require('express');
const { query } = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { machineScope } = require('../utils/scope');

const router = express.Router();
router.use(authenticate);

/** GET /api/notes?limit=50&search=: latest maintenance notes across every work order the user can see */
router.get(
  '/',
  validate({ limit: { type: 'int', min: 1, max: 200 }, search: { type: 'string', max: 100 } }, { source: 'query' }),
  asyncHandler(async (req, res) => {
    const scope = machineScope(req.user);
    const where = [scope.clause];
    const params = [...scope.params];
    const { search } = req.validQuery;
    if (search) {
      where.push('(n.note LIKE ? OR wo.title LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }
    const limit = req.validQuery.limit || 50; // validated integer 1-200, safe to inline
    const rows = await query(
      `SELECT n.id, n.note, n.created_at, u.full_name AS author_name,
              wo.id AS work_order_id, wo.title AS work_order_title, wo.status AS work_order_status,
              m.name AS machine_name, m.asset_tag
         FROM maintenance_notes n
         JOIN work_orders wo ON wo.id = n.work_order_id
         JOIN machines m     ON m.id = wo.machine_id
         JOIN users u        ON u.id = n.author_id
        WHERE ${where.join(' AND ')}
        ORDER BY n.created_at DESC, n.id DESC
        LIMIT ${limit}`,
      params
    );
    res.json({ data: rows, meta: { count: rows.length } });
  })
);

module.exports = router;
