const express = require('express');
const { query } = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, authorize } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { machineScope } = require('../utils/scope');

/*
 * Every report is a live SQL query over the current data; nothing is precomputed or hardcoded.
 * The SQL is kept readable on purpose: these are the queries to walk through in an interview.
 */

const router = express.Router();
router.use(authenticate);

const monthsQuery = validate({ months: { type: 'int', min: 1, max: 24 } }, { source: 'query' });

/**
 * GET /api/reports/summary: KPI cards on the dashboard.
 * Available to both roles; operators get figures for their own line only.
 */
router.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const s = machineScope(req.user);
    const [machines] = await query(
      `SELECT COUNT(*) AS total,
              SUM(m.status = 'running') AS running,
              SUM(m.status = 'idle') AS idle,
              SUM(m.status = 'maintenance') AS maintenance,
              SUM(m.status = 'down') AS down
         FROM machines m WHERE ${s.clause}`,
      s.params
    );
    const [orders] = await query(
      `SELECT SUM(wo.status <> 'closed') AS open_total,
              SUM(wo.status <> 'closed' AND wo.priority IN ('high','critical')) AS open_urgent,
              SUM(wo.status <> 'closed' AND wo.due_date < CURDATE()) AS overdue,
              SUM(wo.status = 'closed' AND wo.closed_at >= CURDATE() - INTERVAL 30 DAY) AS closed_last_30_days
         FROM work_orders wo JOIN machines m ON m.id = wo.machine_id WHERE ${s.clause}`,
      s.params
    );
    const [downtime] = await query(
      `SELECT COALESCE(SUM(TIMESTAMPDIFF(MINUTE, d.started_at, COALESCE(d.ended_at, NOW()))), 0) AS minutes_last_30_days,
              SUM(d.ended_at IS NULL) AS ongoing
         FROM downtime_logs d JOIN machines m ON m.id = d.machine_id
        WHERE ${s.clause} AND d.started_at >= CURDATE() - INTERVAL 30 DAY`,
      s.params
    );
    const [energy] = await query(
      `SELECT COALESCE(ROUND(SUM(e.kwh), 2), 0) AS kwh_last_30_days
         FROM energy_readings e JOIN machines m ON m.id = e.machine_id
        WHERE ${s.clause} AND e.reading_date > CURDATE() - INTERVAL 30 DAY`,
      s.params
    );
    // SUM over zero rows returns NULL in SQL; report 0 instead.
    const zeroNulls = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === null ? 0 : Number(v)]));
    res.json({
      data: {
        machines: zeroNulls(machines),
        workOrders: zeroNulls(orders),
        downtime: zeroNulls(downtime),
        energy: zeroNulls(energy),
      },
    });
  })
);

// Everything below is supervisor-only.
router.use(authorize('supervisor'));

/**
 * 1. JOIN machines <-> work orders.
 * LEFT JOIN keeps machines that have never had a work order (they show zeros).
 */
router.get(
  '/machine-work-orders',
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT m.id AS machine_id, m.asset_tag, m.name AS machine_name, pl.name AS production_line, m.status,
              COUNT(wo.id)                                   AS total_work_orders,
              COALESCE(SUM(wo.status <> 'closed'), 0)        AS open_work_orders,
              COALESCE(SUM(wo.priority = 'critical'), 0)     AS critical_work_orders,
              MAX(wo.created_at)                             AS last_work_order_at
         FROM machines m
         JOIN production_lines pl ON pl.id = m.production_line_id
         LEFT JOIN work_orders wo ON wo.machine_id = m.id
        GROUP BY m.id, m.asset_tag, m.name, pl.name, m.status
        ORDER BY open_work_orders DESC, total_work_orders DESC, m.asset_tag`
    );
    res.json({ data: rows, meta: { count: rows.length } });
  })
);

/** 2. Monthly downtime: GROUP BY calendar month. */
router.get(
  '/monthly-downtime',
  monthsQuery,
  asyncHandler(async (req, res) => {
    const months = req.validQuery.months || 6;
    const rows = await query(
      `SELECT DATE_FORMAT(d.started_at, '%Y-%m')                                        AS month,
              COUNT(*)                                                                AS events,
              SUM(TIMESTAMPDIFF(MINUTE, d.started_at, COALESCE(d.ended_at, NOW())))   AS downtime_minutes,
              ROUND(AVG(TIMESTAMPDIFF(MINUTE, d.started_at, COALESCE(d.ended_at, NOW()))), 1) AS avg_minutes_per_event
         FROM downtime_logs d
        WHERE d.started_at >= DATE_FORMAT(CURDATE() - INTERVAL ? MONTH, '%Y-%m-01') + INTERVAL 1 MONTH
        GROUP BY month
        ORDER BY month`,
      [months]
    );
    res.json({ data: rows, meta: { count: rows.length, months } });
  })
);

/** 3. Monthly energy per production line: JOIN three tables, GROUP BY line and month. */
router.get(
  '/monthly-energy',
  monthsQuery,
  asyncHandler(async (req, res) => {
    const months = req.validQuery.months || 6;
    const rows = await query(
      `SELECT pl.id AS production_line_id, pl.code, pl.name AS production_line,
              DATE_FORMAT(e.reading_date, '%Y-%m') AS month,
              ROUND(SUM(e.kwh), 2)                 AS total_kwh,
              COUNT(DISTINCT e.machine_id)         AS machines_reporting
         FROM energy_readings e
         JOIN machines m          ON m.id = e.machine_id
         JOIN production_lines pl ON pl.id = m.production_line_id
        WHERE e.reading_date >= DATE_FORMAT(CURDATE() - INTERVAL ? MONTH, '%Y-%m-01') + INTERVAL 1 MONTH
        GROUP BY pl.id, pl.code, pl.name, month
        ORDER BY month, pl.code`,
      [months]
    );
    res.json({ data: rows, meta: { count: rows.length, months } });
  })
);

/**
 * 4. Machines with above-average downtime.
 * The inner subquery totals downtime per machine; the outer AVG over it gives the plant average;
 * HAVING keeps only machines above that average.
 */
router.get(
  '/above-average-downtime',
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT m.id AS machine_id, m.asset_tag, m.name AS machine_name, pl.name AS production_line,
              COUNT(d.id)                                                          AS events,
              SUM(TIMESTAMPDIFF(MINUTE, d.started_at, COALESCE(d.ended_at, NOW()))) AS downtime_minutes,
              (SELECT ROUND(AVG(per_machine.total), 1)
                 FROM (SELECT SUM(TIMESTAMPDIFF(MINUTE, d2.started_at, COALESCE(d2.ended_at, NOW()))) AS total
                         FROM downtime_logs d2 GROUP BY d2.machine_id) AS per_machine)  AS plant_average_minutes
         FROM machines m
         JOIN production_lines pl ON pl.id = m.production_line_id
         JOIN downtime_logs d     ON d.machine_id = m.id
        GROUP BY m.id, m.asset_tag, m.name, pl.name
       HAVING downtime_minutes > (
              SELECT AVG(per_machine.total)
                FROM (SELECT SUM(TIMESTAMPDIFF(MINUTE, d3.started_at, COALESCE(d3.ended_at, NOW()))) AS total
                        FROM downtime_logs d3 GROUP BY d3.machine_id) AS per_machine)
        ORDER BY downtime_minutes DESC`
    );
    res.json({ data: rows, meta: { count: rows.length } });
  })
);

/**
 * 5. Maintenance workload per person: how many jobs each person holds and how fast they close them.
 * LEFT JOIN so people with no assignments still appear.
 */
router.get(
  '/maintenance-workload',
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT u.id AS user_id, u.full_name, r.name AS role, pl.name AS production_line,
              COUNT(wo.id)                                         AS total_assigned,
              COALESCE(SUM(wo.status IN ('assigned','in_progress')), 0) AS active,
              COALESCE(SUM(wo.status = 'closed'), 0)               AS closed,
              COALESCE(SUM(wo.status <> 'closed' AND wo.due_date < CURDATE()), 0) AS overdue,
              ROUND(AVG(CASE WHEN wo.status = 'closed'
                             THEN TIMESTAMPDIFF(HOUR, wo.created_at, wo.closed_at) END), 1) AS avg_hours_to_close
         FROM users u
         JOIN roles r                 ON r.id = u.role_id
         LEFT JOIN production_lines pl ON pl.id = u.production_line_id
         LEFT JOIN work_orders wo      ON wo.assigned_to = u.id
        WHERE u.is_active = TRUE
        GROUP BY u.id, u.full_name, r.name, pl.name
        ORDER BY active DESC, total_assigned DESC, u.full_name`
    );
    res.json({ data: rows, meta: { count: rows.length } });
  })
);

/** Downtime by reason category (GROUP BY) for the reports pie/bar chart. */
router.get(
  '/downtime-by-reason',
  monthsQuery,
  asyncHandler(async (req, res) => {
    const months = req.validQuery.months || 6;
    const rows = await query(
      `SELECT d.reason_category,
              COUNT(*) AS events,
              SUM(TIMESTAMPDIFF(MINUTE, d.started_at, COALESCE(d.ended_at, NOW()))) AS downtime_minutes
         FROM downtime_logs d
        WHERE d.started_at >= CURDATE() - INTERVAL ? MONTH
        GROUP BY d.reason_category
        ORDER BY downtime_minutes DESC`,
      [months]
    );
    res.json({ data: rows, meta: { count: rows.length, months } });
  })
);

module.exports = router;
