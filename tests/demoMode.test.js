// Public demo mode: protected demo accounts, protected seeded records, reserved demo email domain,
// the public demo-info endpoint, and the nightly reset restoring the seed dataset.
// Jest gives every test file its own copy of process.env, so these settings only apply here.
process.env.DEMO_MODE = 'true';
process.env.DEMO_PASSWORD = 'Public-Demo-Password-1';

const { app, request, pool, loginAll, auth, resetDb } = require('./helpers');
const { SEEDED_TABLES: SETUP_TABLES } = require('../scripts/db-setup');
const { SEEDED_TABLES: GUARD_TABLES } = require('../src/middleware/demo');

let t;
beforeAll(async () => {
  await resetDb();
  t = await loginAll();
});
afterAll(() => pool.end());

const row = async (sql, params = []) => (await pool.query(sql, params))[0][0];
const expectDemoProtected = (res) => {
  expect(res.status).toBe(403);
  expect(res.body.error.code).toBe('DEMO_PROTECTED');
};

describe('GET /api/public/demo', () => {
  test('returns the public demo accounts and password without signing in', async () => {
    const res = await request(app).get('/api/public/demo');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      enabled: true,
      password: 'Public-Demo-Password-1',
      accounts: [
        { email: 'supervisor@maintainiq.demo', label: 'Supervisor' },
        { email: 'operator@maintainiq.demo', label: 'Operator · Press Shop' },
      ],
    });
  });

  test('never includes server secrets', async () => {
    const body = JSON.stringify((await request(app).get('/api/public/demo')).body);
    expect(body).not.toMatch(/jwt|secret|DB_|host|token/i);
  });
});

describe('demo accounts cannot be modified', () => {
  // Seeded users: 1 supervisor (demo), 2 operator (demo), 3-5 operators, 6 second supervisor.
  const attempts = [
    ['supervisor deactivates their own demo account', 1, { isActive: false }],
    ['supervisor demotes their own demo account', 1, { role: 'operator', productionLineId: 1 }],
    ['supervisor renames their own demo account', 1, { fullName: 'Changed Name' }],
    ['supervisor deactivates the demo operator', 2, { isActive: false }],
    ['supervisor promotes the demo operator to supervisor (privilege escalation)', 2, { role: 'supervisor' }],
    ['supervisor moves the demo operator to another line', 2, { productionLineId: 3 }],
    ['supervisor demotes the other seeded supervisor', 6, { role: 'operator', productionLineId: 2 }],
    ['supervisor deactivates the other seeded supervisor', 6, { isActive: false }],
    ['supervisor deactivates a seeded operator', 3, { isActive: false }],
  ];

  test.each(attempts)('%s -> 403 DEMO_PROTECTED', async (_label, id, body) => {
    expectDemoProtected(await request(app).patch(`/api/users/${id}`).set(auth(t.supervisor)).send(body));
  });

  test('the seeded accounts are unchanged after every attempt', async () => {
    const [rows] = await pool.query(
      `SELECT u.id, u.full_name, r.name AS role, u.production_line_id, u.is_active
         FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id IN (1, 2, 3, 6) ORDER BY u.id`
    );
    expect(rows).toEqual([
      { id: 1, full_name: 'Priya Kulkarni', role: 'supervisor', production_line_id: null, is_active: 1 },
      { id: 2, full_name: 'Rahul Deshmukh', role: 'operator', production_line_id: 1, is_active: 1 },
      { id: 3, full_name: 'Sneha Patil', role: 'operator', production_line_id: 2, is_active: 1 },
      { id: 6, full_name: 'Vikram Rao', role: 'supervisor', production_line_id: null, is_active: 1 },
    ]);
  });

  test('both demo accounts can still sign in after the attempts', async () => {
    const again = await loginAll();
    expect(again.supervisor).toBeTruthy();
    expect(again.operator).toBeTruthy();
  });

  test('an operator still gets 403 FORBIDDEN (not just demo protection) on user management', async () => {
    const res = await request(app).patch('/api/users/2').set(auth(t.operator)).send({ role: 'supervisor' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  test('users created during the demo CAN be edited, promoted and deactivated (normal workflow)', async () => {
    const created = await request(app).post('/api/users').set(auth(t.supervisor)).send({
      fullName: 'Visitor Operator', email: 'visitor.operator@example.com', password: 'Visitor123!', role: 'operator', productionLineId: 2,
    });
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    const patch = (body) => request(app).patch(`/api/users/${id}`).set(auth(t.supervisor)).send(body);
    expect((await patch({ fullName: 'Visitor Renamed' })).status).toBe(200);
    expect((await patch({ role: 'supervisor' })).body.data.role).toBe('supervisor');
    expect((await patch({ isActive: false })).body.data.is_active).toBe(0);
  });

  test('a 404 is still a 404 for users that do not exist', async () => {
    expect((await request(app).patch('/api/users/999999').set(auth(t.supervisor)).send({ isActive: false })).status).toBe(404);
  });
});

describe('the demo email domain is reserved', () => {
  const reg = (email) =>
    request(app).post('/api/auth/register').send({ fullName: 'Lookalike', email, password: 'Lookalike123!', productionLineId: 1 });

  test('self-registration with @maintainiq.demo is rejected', async () => {
    expectDemoProtected(await reg('admin@maintainiq.demo'));
  });

  test('the check is case-insensitive', async () => {
    expectDemoProtected(await reg('Boss@MaintainIQ.Demo'));
  });

  test('a supervisor cannot create a user on the demo domain either', async () => {
    expectDemoProtected(
      await request(app).post('/api/users').set(auth(t.supervisor)).send({
        fullName: 'Fake Supervisor', email: 'second.supervisor@maintainiq.demo', password: 'Fake12345!', role: 'supervisor',
      })
    );
  });

  test('normal registration still works, and the new account is not a protected demo account', async () => {
    const res = await reg('visitor@example.com');
    expect(res.status).toBe(201);
    expect(res.body.data.user.role).toBe('operator');
    const flag = await row('SELECT is_demo_seed FROM users WHERE email = ?', ['visitor@example.com']);
    expect(flag.is_demo_seed).toBe(0);
  });
});

describe('seeded demo records cannot be deleted', () => {
  const seededId = async (table) => (await row(`SELECT MIN(id) AS id FROM ${table} WHERE is_demo_seed = TRUE`)).id;

  test.each([
    ['production line', '/api/production-lines', 'production_lines'],
    ['machine', '/api/machines', 'machines'],
    ['work order', '/api/work-orders', 'work_orders'],
    ['downtime log', '/api/downtime', 'downtime_logs'],
    ['energy reading', '/api/energy', 'energy_readings'],
  ])('deleting a seeded %s -> 403 DEMO_PROTECTED and the row remains', async (_label, path, table) => {
    const id = await seededId(table);
    expectDemoProtected(await request(app).delete(`${path}/${id}`).set(auth(t.supervisor)));
    expect(await row(`SELECT id FROM ${table} WHERE id = ?`, [id])).toBeTruthy();
  });

  test('records created during the demo CAN be deleted (normal workflow)', async () => {
    const sup = (req) => req.set(auth(t.supervisor));

    const line = await sup(request(app).post('/api/production-lines')).send({ code: 'TST', name: 'Test Line', location: 'Hall 9' });
    expect(line.status).toBe(201);
    const machine = await sup(request(app).post('/api/machines')).send({
      productionLineId: line.body.data.id, assetTag: 'TST-001', name: 'Test Machine', machineType: 'Test rig', ratedPowerKw: 5,
    });
    expect(machine.status).toBe(201);
    const wo = await sup(request(app).post('/api/work-orders')).send({ machineId: machine.body.data.id, title: 'Visitor work order' });
    expect(wo.status).toBe(201);
    const dt = await sup(request(app).post('/api/downtime')).send({ machineId: machine.body.data.id, reasonCategory: 'other', startedAt: '2026-01-10T08:00' });
    expect(dt.status).toBe(201);
    const er = await sup(request(app).post('/api/energy')).send({ machineId: machine.body.data.id, readingDate: '2026-01-10', kwh: 12.5 });
    expect(er.status).toBe(201);

    // Delete in dependency order: children first.
    expect((await sup(request(app).delete(`/api/energy/${er.body.data.id}`))).status).toBe(204);
    expect((await sup(request(app).delete(`/api/downtime/${dt.body.data.id}`))).status).toBe(204);
    expect((await sup(request(app).delete(`/api/work-orders/${wo.body.data.id}`))).status).toBe(204);
    expect((await sup(request(app).delete(`/api/machines/${machine.body.data.id}`))).status).toBe(204);
    expect((await sup(request(app).delete(`/api/production-lines/${line.body.data.id}`))).status).toBe(204);
  });

  test('seeded records can still be EDITED (the nightly reset restores them)', async () => {
    const res = await request(app).patch('/api/machines/1/status').set(auth(t.supervisor)).send({ status: 'idle' });
    expect(res.status).toBe(200);
  });

  test('deleting a record that does not exist is still a 404', async () => {
    expect((await request(app).delete('/api/work-orders/999999').set(auth(t.supervisor))).status).toBe(404);
  });
});

describe('seed flag bookkeeping', () => {
  test('the setup script and the delete guard protect the same tables', () => {
    expect([...SETUP_TABLES].sort()).toEqual([...GUARD_TABLES].sort());
  });

  test('db:setup marks every seeded row in every protected table', async () => {
    await resetDb();
    for (const table of SETUP_TABLES) {
      const r = await row(`SELECT COUNT(*) AS total, SUM(is_demo_seed) AS flagged FROM ${table}`);
      expect({ table, total: r.total, flagged: Number(r.flagged) }).toEqual({ table, total: r.total, flagged: r.total });
      expect(r.total).toBeGreaterThan(0);
    }
  });
});

describe('nightly reset (the same setupDatabase() the GitHub Action runs)', () => {
  // Snapshot every business column of every table. Bcrypt hashes and row timestamps differ between runs by
  // design, and the seed dates its records relative to NOW() (so the demo always shows recent activity),
  // so dates are compared as "days from now" instead of absolute values.
  async function snapshot() {
    const [tables] = await pool.query(
      `SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name`
    );
    const out = {};
    for (const { t: table } of tables) {
      const [cols] = await pool.query(
        `SELECT column_name AS c, data_type AS type FROM information_schema.columns
          WHERE table_schema = DATABASE() AND table_name = ? AND column_name NOT IN ('created_at', 'updated_at', 'password_hash')
          ORDER BY ordinal_position`,
        [table]
      );
      const list = cols
        .map(({ c, type }) => (['date', 'datetime'].includes(type) ? `DATEDIFF(\`${c}\`, NOW()) AS \`${c}\`` : `\`${c}\``))
        .join(', ');
      [out[table]] = await pool.query(`SELECT ${list} FROM \`${table}\` ORDER BY id`);
    }
    return out;
  }

  test('restores the original demo dataset after visitors change it', async () => {
    await resetDb();
    const original = await snapshot();
    const tokens = await loginAll();

    // Visitor activity: edits to seeded data and new records of every kind.
    await request(app).patch('/api/machines/2/status').set(auth(tokens.supervisor)).send({ status: 'down' });
    await request(app).patch('/api/work-orders/1').set(auth(tokens.supervisor)).send({ title: 'Changed by a visitor' });
    await request(app).post('/api/work-orders').set(auth(tokens.operator)).send({ machineId: 1, title: 'Visitor request' });
    await request(app).post('/api/auth/register').send({ fullName: 'Visitor', email: 'reset.visitor@example.com', password: 'Visitor123!', productionLineId: 1 });
    expect(await snapshot()).not.toEqual(original);

    await resetDb();
    expect(await snapshot()).toEqual(original);
  });
});
