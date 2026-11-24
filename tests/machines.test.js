const { app, request, pool, loginAll, auth, resetDb } = require('./helpers');

let t; // tokens
beforeAll(async () => {
  await resetDb();
  t = await loginAll();
});
afterAll(() => pool.end());

describe('GET /api/machines', () => {
  test('401 without a token', async () => {
    expect((await request(app).get('/api/machines')).status).toBe(401);
  });

  test('supervisor sees every machine with its production line (JOIN)', async () => {
    const res = await request(app).get('/api/machines').set(auth(t.supervisor));
    expect(res.status).toBe(200);
    expect(res.body.meta.count).toBe(12);
    expect(res.body.data[0]).toHaveProperty('production_line');
    expect(res.body.data[0]).toHaveProperty('open_work_orders');
  });

  test('operator sees only machines on their own line', async () => {
    const res = await request(app).get('/api/machines').set(auth(t.operator));
    expect(res.status).toBe(200);
    expect(res.body.meta.count).toBe(3);
    expect(res.body.data.every((m) => m.production_line_id === 1)).toBe(true);
  });

  test('filters by status and search text', async () => {
    const byStatus = await request(app).get('/api/machines?status=down').set(auth(t.supervisor));
    expect(byStatus.body.data.map((m) => m.asset_tag)).toEqual(['ASM-202']);
    const bySearch = await request(app).get('/api/machines?search=press').set(auth(t.supervisor));
    expect(bySearch.body.data.map((m) => m.asset_tag)).toEqual(['PRS-001', 'PRS-002']);
  });

  test('400 for an invalid status filter', async () => {
    const res = await request(app).get('/api/machines?status=exploded').set(auth(t.supervisor));
    expect(res.status).toBe(400);
  });
});

describe('GET /api/machines/:id', () => {
  test('returns one machine', async () => {
    const res = await request(app).get('/api/machines/1').set(auth(t.operator));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: 1, asset_tag: 'PRS-001', production_line: 'Press Shop' });
  });

  test('403 when an operator opens a machine on another line', async () => {
    const res = await request(app).get('/api/machines/4').set(auth(t.operator));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  test.each(['abc', '0', '-1', '1.5'])('400 for invalid id "%s"', async (id) => {
    const res = await request(app).get(`/api/machines/${id}`).set(auth(t.supervisor));
    expect(res.status).toBe(400);
  });

  test('404 for an id that does not exist', async () => {
    const res = await request(app).get('/api/machines/99999').set(auth(t.supervisor));
    expect(res.status).toBe(404);
  });
});

describe('Machine create / update / delete', () => {
  const newMachine = {
    productionLineId: 2,
    assetTag: 'CNC-199',
    name: 'Test Grinder',
    machineType: 'Surface grinder',
    ratedPowerKw: 12.5,
    installedOn: '2024-05-01',
  };
  let createdId;

  test('supervisor creates a machine (201)', async () => {
    const res = await request(app).post('/api/machines').set(auth(t.supervisor)).send(newMachine);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ asset_tag: 'CNC-199', rated_power_kw: 12.5, status: 'running' });
    createdId = res.body.data.id;
  });

  test('operator cannot create machines (403)', async () => {
    const res = await request(app).post('/api/machines').set(auth(t.operator)).send({ ...newMachine, assetTag: 'X-1' });
    expect(res.status).toBe(403);
  });

  test('duplicate asset tag returns 409', async () => {
    const res = await request(app).post('/api/machines').set(auth(t.supervisor)).send(newMachine);
    expect(res.status).toBe(409);
  });

  test('validation: negative power and impossible date', async () => {
    const res = await request(app)
      .post('/api/machines')
      .set(auth(t.supervisor))
      .send({ ...newMachine, assetTag: 'CNC-198', ratedPowerKw: -5, installedOn: '2024-02-30' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d) => d.field).sort()).toEqual(['installedOn', 'ratedPowerKw']);
  });

  test('unknown production line returns 400 (foreign key)', async () => {
    const res = await request(app)
      .post('/api/machines')
      .set(auth(t.supervisor))
      .send({ ...newMachine, assetTag: 'CNC-197', productionLineId: 999 });
    expect(res.status).toBe(400);
  });

  test('supervisor updates selected fields with PATCH', async () => {
    const res = await request(app).patch(`/api/machines/${createdId}`).set(auth(t.supervisor)).send({ name: 'Renamed', status: 'idle' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: 'Renamed', status: 'idle', asset_tag: 'CNC-199' });
  });

  test('PATCH with an empty body is a 400', async () => {
    const res = await request(app).patch(`/api/machines/${createdId}`).set(auth(t.supervisor)).send({});
    expect(res.status).toBe(400);
  });

  test('operator can change status on their own line but not another', async () => {
    const own = await request(app).patch('/api/machines/2/status').set(auth(t.operator)).send({ status: 'maintenance' });
    expect(own.status).toBe(200);
    expect(own.body.data.status).toBe('maintenance');
    const other = await request(app).patch('/api/machines/5/status').set(auth(t.operator)).send({ status: 'down' });
    expect(other.status).toBe(403);
  });

  test('a machine with history cannot be deleted (409)', async () => {
    const res = await request(app).delete('/api/machines/1').set(auth(t.supervisor));
    expect(res.status).toBe(409);
  });

  test('operator cannot delete (403); supervisor deletes a new machine (204), then 404', async () => {
    expect((await request(app).delete(`/api/machines/${createdId}`).set(auth(t.operator))).status).toBe(403);
    expect((await request(app).delete(`/api/machines/${createdId}`).set(auth(t.supervisor))).status).toBe(204);
    expect((await request(app).delete(`/api/machines/${createdId}`).set(auth(t.supervisor))).status).toBe(404);
  });
});
