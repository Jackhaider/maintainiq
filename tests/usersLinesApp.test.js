const { app, request, pool, PASSWORD, loginAll, auth, resetDb } = require('./helpers');

let t;
beforeAll(async () => {
  await resetDb();
  t = await loginAll();
});
afterAll(() => pool.end());

describe('User management (supervisor only)', () => {
  test('operator gets 403 on every /api/users route', async () => {
    expect((await request(app).get('/api/users').set(auth(t.operator))).status).toBe(403);
    expect((await request(app).post('/api/users').set(auth(t.operator)).send({})).status).toBe(403);
    expect((await request(app).patch('/api/users/2').set(auth(t.operator)).send({ isActive: false })).status).toBe(403);
  });

  test('supervisor lists users without password hashes', async () => {
    const res = await request(app).get('/api/users').set(auth(t.supervisor));
    expect(res.status).toBe(200);
    expect(res.body.meta.count).toBe(6);
    expect(JSON.stringify(res.body)).not.toMatch(/password/);
  });

  test('supervisor creates another supervisor who can log in', async () => {
    const res = await request(app).post('/api/users').set(auth(t.supervisor)).send({
      fullName: 'New Supervisor', email: 'new.sup@example.com', password: 'Another123!', role: 'supervisor', productionLineId: 3,
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ role: 'supervisor', production_line_id: null });
    const login = await request(app).post('/api/auth/login').send({ email: 'new.sup@example.com', password: 'Another123!' });
    expect(login.body.data.user.role).toBe('supervisor');
  });

  test('an operator must have a production line', async () => {
    const res = await request(app).post('/api/users').set(auth(t.supervisor)).send({
      fullName: 'No Line', email: 'noline@example.com', password: 'Another123!', role: 'operator',
    });
    expect(res.status).toBe(400);
  });

  test('changing a role takes effect on the next request', async () => {
    const res = await request(app).patch('/api/users/5').set(auth(t.supervisor)).send({ role: 'supervisor' });
    expect(res.body.data.role).toBe('supervisor');
    const login = await request(app).post('/api/auth/login').send({ email: 'anita.joshi@maintainiq.demo', password: PASSWORD });
    const reports = await request(app).get('/api/reports/monthly-energy').set(auth(login.body.data.token));
    expect(reports.status).toBe(200);
  });

  test('a supervisor cannot deactivate themselves (409)', async () => {
    const res = await request(app).patch('/api/users/1').set(auth(t.supervisor)).send({ isActive: false });
    expect(res.status).toBe(409);
  });

  test('404 for an unknown user', async () => {
    expect((await request(app).get('/api/users/9999').set(auth(t.supervisor))).status).toBe(404);
  });
});

describe('Production lines', () => {
  test('both roles can list lines with machine counts (LEFT JOIN + GROUP BY)', async () => {
    const res = await request(app).get('/api/production-lines').set(auth(t.operator));
    expect(res.status).toBe(200);
    expect(res.body.data.map((l) => l.machine_count)).toEqual([3, 3, 3, 3]);
  });

  test('public endpoint for the registration form exposes only id, code and name', async () => {
    const res = await request(app).get('/api/public/production-lines');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data[0]).sort()).toEqual(['code', 'id', 'name']);
  });

  test('supervisor creates a line; an empty line can be deleted, a used line cannot', async () => {
    const created = await request(app).post('/api/production-lines').set(auth(t.supervisor)).send({ code: 'pl-tst', name: 'Test Line', location: 'Lab' });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ code: 'PL-TST', machine_count: 0 });
    expect((await request(app).delete('/api/production-lines/1').set(auth(t.supervisor))).status).toBe(409);
    expect((await request(app).delete(`/api/production-lines/${created.body.data.id}`).set(auth(t.supervisor))).status).toBe(204);
  });

  test('operator cannot create lines (403)', async () => {
    const res = await request(app).post('/api/production-lines').set(auth(t.operator)).send({ code: 'X', name: 'X', location: 'X' });
    expect(res.status).toBe(403);
  });
});

describe('App-level behaviour', () => {
  test('GET /api/health reports the database as reachable', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'ok' });
  });

  test('unknown API routes return a JSON 404', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  test('security headers are set (helmet)', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  test('a request body over 100 kB is rejected with 413', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'a@b.co', password: 'x'.repeat(150 * 1024) });
    expect(res.status).toBe(413);
  });

  test('the frontend is served for non-API paths', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
  });
});
