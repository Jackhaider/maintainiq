const { app, request, pool, loginAll, auth, resetDb } = require('./helpers');

let t;
beforeAll(async () => {
  await resetDb();
  t = await loginAll();
});
afterAll(() => pool.end());

describe('Downtime', () => {
  let logId;

  test('operator records a finished stoppage; duration is calculated by SQL', async () => {
    const res = await request(app).post('/api/downtime').set(auth(t.operator)).send({
      machineId: 1,
      reasonCategory: 'mechanical',
      description: 'Die change jammed',
      startedAt: '2026-01-10T08:00',
      endedAt: '2026-01-10T09:30',
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ machine_id: 1, duration_minutes: 90, reported_by_name: 'Rahul Deshmukh' });
  });

  test('endedAt before startedAt is a 400', async () => {
    const res = await request(app)
      .post('/api/downtime')
      .set(auth(t.operator))
      .send({ machineId: 1, reasonCategory: 'other', startedAt: '2026-01-10T10:00', endedAt: '2026-01-10T09:00' });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe('endedAt');
  });

  test('invalid reason and date formats are rejected', async () => {
    const res = await request(app)
      .post('/api/downtime')
      .set(auth(t.operator))
      .send({ machineId: 1, reasonCategory: 'aliens', startedAt: '10/01/2026' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d) => d.field).sort()).toEqual(['reasonCategory', 'startedAt']);
  });

  test('work order must belong to the same machine', async () => {
    const res = await request(app)
      .post('/api/downtime')
      .set(auth(t.operator))
      .send({ machineId: 1, reasonCategory: 'other', startedAt: '2026-01-11T08:00', workOrderId: 2 });
    expect(res.status).toBe(400);
  });

  test('operator cannot log downtime on another line (403)', async () => {
    const res = await request(app)
      .post('/api/downtime')
      .set(auth(t.operator))
      .send({ machineId: 7, reasonCategory: 'other', startedAt: '2026-01-11T08:00' });
    expect(res.status).toBe(403);
  });

  test('an ongoing stoppage can be ended once', async () => {
    const created = await request(app)
      .post('/api/downtime')
      .set(auth(t.operator))
      .send({ machineId: 3, reasonCategory: 'electrical', startedAt: '2026-01-12T06:00' });
    expect(created.status).toBe(201);
    expect(created.body.data.ended_at).toBeNull();
    logId = created.body.data.id;

    const ongoing = await request(app).get('/api/downtime?ongoing=true').set(auth(t.operator));
    expect(ongoing.body.data.map((d) => d.id)).toContain(logId);

    const ended = await request(app).patch(`/api/downtime/${logId}/end`).set(auth(t.operator)).send({ endedAt: '2026-01-12T07:15' });
    expect(ended.status).toBe(200);
    expect(ended.body.data.duration_minutes).toBe(75);

    const again = await request(app).patch(`/api/downtime/${logId}/end`).set(auth(t.operator)).send({});
    expect(again.status).toBe(409);
  });

  test('list is scoped by line and filterable by date range', async () => {
    const res = await request(app).get('/api/downtime?from=2026-01-10&to=2026-01-12').set(auth(t.supervisor));
    expect(res.status).toBe(200);
    expect(res.body.data.map((d) => d.started_at.slice(0, 10)).every((d) => d >= '2026-01-10' && d <= '2026-01-12')).toBe(true);

    const op = await request(app).get('/api/downtime').set(auth(t.operatorLine2));
    expect(op.body.data.every((d) => d.production_line_id === 2)).toBe(true);
  });

  test('operator cannot delete (403); supervisor can (204)', async () => {
    expect((await request(app).delete(`/api/downtime/${logId}`).set(auth(t.operator))).status).toBe(403);
    expect((await request(app).delete(`/api/downtime/${logId}`).set(auth(t.supervisor))).status).toBe(204);
  });
});

describe('Energy readings', () => {
  test('operator submits a reading (201)', async () => {
    const res = await request(app).post('/api/energy').set(auth(t.operator)).send({ machineId: 2, readingDate: '2020-01-01', kwh: 512.75 });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ machine_id: 2, reading_date: '2020-01-01', kwh: 512.75 });
  });

  test('a second reading for the same machine and day is a 409 (unique constraint)', async () => {
    const res = await request(app).post('/api/energy').set(auth(t.operator)).send({ machineId: 2, readingDate: '2020-01-01', kwh: 100 });
    expect(res.status).toBe(409);
  });

  test('negative kWh and future dates are rejected (400)', async () => {
    const neg = await request(app).post('/api/energy').set(auth(t.operator)).send({ machineId: 2, readingDate: '2020-01-02', kwh: -1 });
    expect(neg.status).toBe(400);
    const future = await request(app).post('/api/energy').set(auth(t.operator)).send({ machineId: 2, readingDate: '2999-01-01', kwh: 5 });
    expect(future.status).toBe(400);
  });

  test('operator cannot submit for another line (403)', async () => {
    const res = await request(app).post('/api/energy').set(auth(t.operator)).send({ machineId: 12, readingDate: '2020-01-01', kwh: 5 });
    expect(res.status).toBe(403);
  });

  test('daily totals (GROUP BY) match a direct SQL sum', async () => {
    const res = await request(app).get('/api/energy/daily?days=7').set(auth(t.supervisor));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(7);
    const [[db]] = await pool.query(
      'SELECT ROUND(SUM(kwh), 2) AS total FROM energy_readings WHERE reading_date > CURDATE() - INTERVAL 7 DAY'
    );
    const apiTotal = res.body.data.reduce((sum, d) => sum + d.total_kwh, 0);
    expect(apiTotal).toBeCloseTo(Number(db.total), 1);
  });

  test('operator daily totals only include their line', async () => {
    const sup = await request(app).get('/api/energy/daily?days=3').set(auth(t.supervisor));
    const op = await request(app).get('/api/energy/daily?days=3').set(auth(t.operator));
    expect(op.body.data[0].readings).toBe(3); // 3 machines on line 1
    expect(sup.body.data[0].readings).toBe(12);
  });

  test('list supports machine filter and limit', async () => {
    const res = await request(app).get('/api/energy?machineId=4&limit=10').set(auth(t.supervisor));
    expect(res.body.data).toHaveLength(10);
    expect(res.body.data.every((r) => r.machine_id === 4)).toBe(true);
  });

  test('only supervisors delete readings; unknown id is 404', async () => {
    const [[row]] = await pool.query('SELECT id FROM energy_readings ORDER BY id LIMIT 1');
    expect((await request(app).delete(`/api/energy/${row.id}`).set(auth(t.operator))).status).toBe(403);
    expect((await request(app).delete(`/api/energy/${row.id}`).set(auth(t.supervisor))).status).toBe(204);
    expect((await request(app).delete(`/api/energy/${row.id}`).set(auth(t.supervisor))).status).toBe(404);
  });
});
