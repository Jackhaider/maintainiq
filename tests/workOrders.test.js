const { app, request, pool, loginAll, auth, resetDb } = require('./helpers');

let t;
beforeAll(async () => {
  await resetDb();
  t = await loginAll();
});
afterAll(() => pool.end());

describe('Work order lifecycle', () => {
  let woId;

  test('operator raises a maintenance request on their line: status open, unassigned', async () => {
    const res = await request(app)
      .post('/api/work-orders')
      .set(auth(t.operator))
      .send({ machineId: 2, title: 'Strange knocking noise', description: 'Started this shift', priority: 'high' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      status: 'open',
      priority: 'high',
      order_type: 'corrective',
      assigned_to: null,
      requested_by_name: 'Rahul Deshmukh',
      machine_name: 'Servo Press 250T',
    });
    woId = res.body.data.id;
  });

  test('operator cannot raise a request for a machine on another line (403)', async () => {
    const res = await request(app).post('/api/work-orders').set(auth(t.operator)).send({ machineId: 10, title: 'Not my line' });
    expect(res.status).toBe(403);
  });

  test('operator cannot assign at creation time (403)', async () => {
    const res = await request(app).post('/api/work-orders').set(auth(t.operator)).send({ machineId: 1, title: 'Assign me', assignedTo: 2 });
    expect(res.status).toBe(403);
  });

  test('validation errors for a bad body', async () => {
    const res = await request(app)
      .post('/api/work-orders')
      .set(auth(t.supervisor))
      .send({ machineId: 'one', title: 'x', priority: 'urgent', dueDate: 'tomorrow' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d) => d.field).sort()).toEqual(['dueDate', 'machineId', 'priority', 'title']);
  });

  test('404 when the machine does not exist', async () => {
    const res = await request(app).post('/api/work-orders').set(auth(t.supervisor)).send({ machineId: 9999, title: 'Ghost machine' });
    expect(res.status).toBe(404);
  });

  test('operator cannot assign (403); supervisor assigns (status becomes assigned)', async () => {
    expect((await request(app).post(`/api/work-orders/${woId}/assign`).set(auth(t.operator)).send({ assignedTo: 2 })).status).toBe(403);
    const res = await request(app).post(`/api/work-orders/${woId}/assign`).set(auth(t.supervisor)).send({ assignedTo: 2 });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'assigned', assigned_to: 2, assigned_to_name: 'Rahul Deshmukh' });
  });

  test('assigning a user that does not exist is a 400', async () => {
    const res = await request(app).post(`/api/work-orders/${woId}/assign`).set(auth(t.supervisor)).send({ assignedTo: 9999 });
    expect(res.status).toBe(400);
  });

  test('only the assignee or a supervisor can start the job', async () => {
    // Work order 16 is on the operator's own line but not assigned to them.
    expect((await request(app).post('/api/work-orders/16/start').set(auth(t.operator))).status).toBe(403);
    const res = await request(app).post(`/api/work-orders/${woId}/start`).set(auth(t.operator));
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('in_progress');
  });

  test('anyone on the line can add a note; empty notes are rejected', async () => {
    const ok = await request(app).post(`/api/work-orders/${woId}/notes`).set(auth(t.operator)).send({ note: 'Found a loose bolt on the ram guide.' });
    expect(ok.status).toBe(201);
    expect(ok.body.data).toMatchObject({ author_name: 'Rahul Deshmukh', work_order_id: woId });
    const bad = await request(app).post(`/api/work-orders/${woId}/notes`).set(auth(t.operator)).send({ note: '' });
    expect(bad.status).toBe(400);
  });

  test('operator cannot close (403); supervisor closes with a resolution note', async () => {
    expect((await request(app).post(`/api/work-orders/${woId}/close`).set(auth(t.operator)).send({})).status).toBe(403);
    const res = await request(app).post(`/api/work-orders/${woId}/close`).set(auth(t.supervisor)).send({ resolution: 'Bolt torqued, test run OK' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('closed');
    expect(res.body.data.closed_at).not.toBeNull();

    const detail = await request(app).get(`/api/work-orders/${woId}`).set(auth(t.operator));
    expect(detail.body.data.notes.map((n) => n.note)).toEqual([
      'Found a loose bolt on the ram guide.',
      'Closed: Bolt torqued, test run OK',
    ]);
  });

  test('closing twice or reassigning a closed order is a 409', async () => {
    expect((await request(app).post(`/api/work-orders/${woId}/close`).set(auth(t.supervisor)).send({})).status).toBe(409);
    expect((await request(app).post(`/api/work-orders/${woId}/assign`).set(auth(t.supervisor)).send({ assignedTo: 3 })).status).toBe(409);
  });

  test('operators cannot add notes to a closed order (409)', async () => {
    const res = await request(app).post(`/api/work-orders/${woId}/notes`).set(auth(t.operator)).send({ note: 'Late note' });
    expect(res.status).toBe(409);
  });
});

describe('Work order reads, updates and deletes', () => {
  test('supervisor sees all orders; operator only their line', async () => {
    const all = await request(app).get('/api/work-orders').set(auth(t.supervisor));
    const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM work_orders');
    expect(all.body.meta.count).toBe(total);

    const mine = await request(app).get('/api/work-orders').set(auth(t.operator));
    expect(mine.body.data.length).toBeGreaterThan(0);
    expect(mine.body.data.every((w) => w.production_line_id === 1)).toBe(true);
  });

  test('open orders are listed before closed ones, critical first', async () => {
    const res = await request(app).get('/api/work-orders').set(auth(t.supervisor));
    const firstClosed = res.body.data.findIndex((w) => w.status === 'closed');
    expect(res.body.data.slice(firstClosed).every((w) => w.status === 'closed')).toBe(true);
    expect(res.body.data[0].priority).toBe('critical');
  });

  test('filters by status', async () => {
    const res = await request(app).get('/api/work-orders?status=open').set(auth(t.supervisor));
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data.every((w) => w.status === 'open')).toBe(true);
  });

  test('operator cannot open a work order from another line (403)', async () => {
    expect((await request(app).get('/api/work-orders/4').set(auth(t.operator))).status).toBe(403);
  });

  test('supervisor edits details; operator cannot (403)', async () => {
    expect((await request(app).patch('/api/work-orders/4').set(auth(t.operator)).send({ priority: 'low' })).status).toBe(403);
    const res = await request(app).patch('/api/work-orders/4').set(auth(t.supervisor)).send({ priority: 'critical', dueDate: '2030-01-15' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ priority: 'critical', due_date: '2030-01-15' });
  });

  test('supervisor creates an order already assigned', async () => {
    const res = await request(app)
      .post('/api/work-orders')
      .set(auth(t.supervisor))
      .send({ machineId: 6, title: 'PM: way lube check', orderType: 'preventive', assignedTo: 3 });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'assigned', assigned_to: 3, order_type: 'preventive' });
  });

  test('delete removes the order and its notes (ON DELETE CASCADE)', async () => {
    const [[before]] = await pool.query('SELECT COUNT(*) AS n FROM maintenance_notes WHERE work_order_id = 1');
    expect(before.n).toBeGreaterThan(0);
    expect((await request(app).delete('/api/work-orders/1').set(auth(t.supervisor))).status).toBe(204);
    const [[after]] = await pool.query('SELECT COUNT(*) AS n FROM maintenance_notes WHERE work_order_id = 1');
    expect(after.n).toBe(0);
    expect((await request(app).get('/api/work-orders/1').set(auth(t.supervisor))).status).toBe(404);
  });

  test('400 for a non-numeric id', async () => {
    expect((await request(app).get('/api/work-orders/abc').set(auth(t.supervisor))).status).toBe(400);
  });

  test('GET /api/notes returns recent notes scoped to the user', async () => {
    const res = await request(app).get('/api/notes?limit=5').set(auth(t.operator));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(5);
    const machines = await request(app).get('/api/machines').set(auth(t.operator));
    const allowed = new Set(machines.body.data.map((m) => m.asset_tag));
    expect(res.body.data.every((n) => allowed.has(n.asset_tag))).toBe(true);
  });
});
