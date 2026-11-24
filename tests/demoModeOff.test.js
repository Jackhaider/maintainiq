// With DEMO_MODE unset (local development, CI, self-hosting) nothing about demo mode applies.
delete process.env.DEMO_MODE;
delete process.env.DEMO_PASSWORD;

const { app, request, pool, loginAll, auth, resetDb } = require('./helpers');

let t;
beforeAll(async () => {
  await resetDb();
  t = await loginAll();
});
afterAll(() => pool.end());

describe('demo mode off (default)', () => {
  test('GET /api/public/demo reports demo mode as disabled and reveals no password', async () => {
    const res = await request(app).get('/api/public/demo');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ enabled: false });
  });

  test('seeded accounts can be managed normally', async () => {
    const res = await request(app).patch('/api/users/3').set(auth(t.supervisor)).send({ isActive: false });
    expect(res.status).toBe(200);
    expect(res.body.data.is_active).toBe(0);
  });

  test('the self-protection rule still applies without demo mode', async () => {
    const res = await request(app).patch('/api/users/1').set(auth(t.supervisor)).send({ isActive: false });
    expect(res.status).toBe(409);
  });

  test('seeded records can be deleted normally', async () => {
    const [[reading]] = await pool.query('SELECT MIN(id) AS id FROM energy_readings');
    expect((await request(app).delete(`/api/energy/${reading.id}`).set(auth(t.supervisor))).status).toBe(204);
  });

  test('the maintainiq.demo domain is not reserved', async () => {
    const res = await request(app).post('/api/auth/register').send({
      fullName: 'Local Tester', email: 'local.tester@maintainiq.demo', password: 'Local12345!', productionLineId: 1,
    });
    expect(res.status).toBe(201);
  });
});
