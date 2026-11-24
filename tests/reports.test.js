/*
 * Report tests check the API numbers against independent SQL written in the test,
 * which proves the reports come from the data rather than from fixed values.
 */
const { app, request, pool, loginAll, auth, resetDb } = require('./helpers');

let t;
beforeAll(async () => {
  await resetDb();
  t = await loginAll();
});
afterAll(() => pool.end());

const SUPERVISOR_REPORTS = [
  'machine-work-orders',
  'monthly-downtime',
  'monthly-energy',
  'above-average-downtime',
  'maintenance-workload',
  'downtime-by-reason',
];

describe('Access control', () => {
  test.each(SUPERVISOR_REPORTS)('%s: 401 without token, 403 for operator, 200 for supervisor', async (name) => {
    expect((await request(app).get(`/api/reports/${name}`)).status).toBe(401);
    expect((await request(app).get(`/api/reports/${name}`).set(auth(t.operator))).status).toBe(403);
    expect((await request(app).get(`/api/reports/${name}`).set(auth(t.supervisor))).status).toBe(200);
  });

  test('months must be 1-24', async () => {
    const res = await request(app).get('/api/reports/monthly-downtime?months=99').set(auth(t.supervisor));
    expect(res.status).toBe(400);
  });
});

describe('Summary (dashboard KPIs)', () => {
  test('supervisor sees plant-wide numbers', async () => {
    const res = await request(app).get('/api/reports/summary').set(auth(t.supervisor));
    expect(res.status).toBe(200);
    const [[db]] = await pool.query(`SELECT COUNT(*) AS machines, SUM(status = 'down') AS down FROM machines`);
    expect(res.body.data.machines.total).toBe(db.machines);
    expect(res.body.data.machines.down).toBe(Number(db.down));
    const [[wo]] = await pool.query(`SELECT COUNT(*) AS open FROM work_orders WHERE status <> 'closed'`);
    expect(res.body.data.workOrders.open_total).toBe(wo.open);
  });

  test('operator summary only covers their line', async () => {
    const res = await request(app).get('/api/reports/summary').set(auth(t.operator));
    expect(res.status).toBe(200);
    expect(res.body.data.machines.total).toBe(3);
  });
});

describe('Report contents match the database', () => {
  test('machine-work-orders: one row per machine, totals equal COUNT(*)', async () => {
    const res = await request(app).get('/api/reports/machine-work-orders').set(auth(t.supervisor));
    expect(res.body.meta.count).toBe(12);
    const apiTotal = res.body.data.reduce((s, r) => s + r.total_work_orders, 0);
    const [[db]] = await pool.query('SELECT COUNT(*) AS n FROM work_orders');
    expect(apiTotal).toBe(db.n);
  });

  test('machine-work-orders: a machine with no work orders still appears with zeros (LEFT JOIN)', async () => {
    await pool.query(
      "INSERT INTO machines (production_line_id, asset_tag, name, machine_type, rated_power_kw) VALUES (1, 'NEW-001', 'Brand new press', 'Press', 10)"
    );
    const res = await request(app).get('/api/reports/machine-work-orders').set(auth(t.supervisor));
    expect(res.body.data.find((r) => r.asset_tag === 'NEW-001')).toMatchObject({ total_work_orders: 0, open_work_orders: 0 });
    await pool.query("DELETE FROM machines WHERE asset_tag = 'NEW-001'");
  });

  test('monthly-downtime: months ascending, event counts add up', async () => {
    const res = await request(app).get('/api/reports/monthly-downtime?months=6').set(auth(t.supervisor));
    const months = res.body.data.map((r) => r.month);
    expect(months).toEqual([...months].sort());
    expect(months.length).toBeLessThanOrEqual(6);
    const [[db]] = await pool.query(
      `SELECT COUNT(*) AS n FROM downtime_logs
        WHERE started_at >= DATE_FORMAT(CURDATE() - INTERVAL 6 MONTH, '%Y-%m-01') + INTERVAL 1 MONTH`
    );
    expect(res.body.data.reduce((s, r) => s + r.events, 0)).toBe(db.n);
  });

  test('monthly-energy: per line per month, adding a reading changes the total', async () => {
    const before = await request(app).get('/api/reports/monthly-energy?months=1').set(auth(t.supervisor));
    const lineRow = (body) => body.data.find((r) => r.code === 'PL-PRS');
    const prev = lineRow(before.body).total_kwh;

    // Remove today's reading for machine 1 and re-add it with a known value: the report must follow.
    const [[today]] = await pool.query('SELECT kwh FROM energy_readings WHERE machine_id = 1 AND reading_date = CURDATE()');
    await pool.query('UPDATE energy_readings SET kwh = kwh + 1000 WHERE machine_id = 1 AND reading_date = CURDATE()');
    const after = await request(app).get('/api/reports/monthly-energy?months=1').set(auth(t.supervisor));
    expect(lineRow(after.body).total_kwh).toBeCloseTo(prev + 1000, 1);
    await pool.query('UPDATE energy_readings SET kwh = ? WHERE machine_id = 1 AND reading_date = CURDATE()', [today.kwh]);
  });

  test('above-average-downtime: every machine returned is above the plant average', async () => {
    const res = await request(app).get('/api/reports/above-average-downtime').set(auth(t.supervisor));
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const row of res.body.data) {
      expect(row.downtime_minutes).toBeGreaterThan(row.plant_average_minutes);
    }
    // The seed makes PRS-003 and ASM-202 the least reliable machines.
    expect(res.body.data.map((r) => r.asset_tag)).toEqual(expect.arrayContaining(['PRS-003', 'ASM-202']));
  });

  test('maintenance-workload: assigned counts equal work orders per assignee', async () => {
    const res = await request(app).get('/api/reports/maintenance-workload').set(auth(t.supervisor));
    const [db] = await pool.query('SELECT assigned_to, COUNT(*) AS n FROM work_orders WHERE assigned_to IS NOT NULL GROUP BY assigned_to');
    for (const { assigned_to: id, n } of db) {
      expect(res.body.data.find((r) => r.user_id === id).total_assigned).toBe(n);
    }
  });

  test('downtime-by-reason groups by category', async () => {
    const res = await request(app).get('/api/reports/downtime-by-reason').set(auth(t.supervisor));
    const reasons = res.body.data.map((r) => r.reason_category);
    expect(new Set(reasons).size).toBe(reasons.length);
    expect(reasons.length).toBe(5);
  });
});
