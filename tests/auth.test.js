const jwt = require('jsonwebtoken');
const config = require('../src/config/env');
const { app, request, pool, PASSWORD, USERS, login, auth, resetDb } = require('./helpers');

beforeAll(resetDb);
afterAll(() => pool.end());

describe('POST /api/auth/register', () => {
  const valid = { fullName: 'Test Operator', email: 'new.operator@example.com', password: 'Secret123!', productionLineId: 2 };

  test('creates an operator account and returns a token', async () => {
    const res = await request(app).post('/api/auth/register').send(valid);
    expect(res.status).toBe(201);
    expect(res.body.data.token).toEqual(expect.any(String));
    expect(res.body.data.user).toMatchObject({ email: valid.email, role: 'operator', productionLineId: 2 });
    expect(res.body.data.user).not.toHaveProperty('password_hash');
  });

  test('stores a bcrypt hash, never the plain password', async () => {
    const [rows] = await pool.query('SELECT password_hash FROM users WHERE email = ?', [valid.email]);
    expect(rows[0].password_hash).toMatch(/^\$2[aby]\$\d{2}\$.{53}$/);
    expect(rows[0].password_hash).not.toContain(valid.password);
  });

  test('ignores an attempt to self-register as supervisor', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...valid, email: 'sneaky@example.com', role: 'supervisor' });
    expect(res.status).toBe(201);
    expect(res.body.data.user.role).toBe('operator');
  });

  test('rejects a duplicate email with 409', async () => {
    const res = await request(app).post('/api/auth/register').send(valid);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  test('returns 400 with field details when required fields are missing', async () => {
    const res = await request(app).post('/api/auth/register').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const fields = res.body.error.details.map((d) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['fullName', 'email', 'password', 'productionLineId']));
  });

  test.each([
    ['invalid email', { email: 'not-an-email' }, 'email'],
    ['short password', { password: 'short' }, 'password'],
    ['non-numeric line', { productionLineId: 'abc' }, 'productionLineId'],
  ])('rejects %s', async (_label, override, field) => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...valid, email: 'x@example.com', ...override });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe(field);
  });

  test('rejects a production line that does not exist', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...valid, email: 'y@example.com', productionLineId: 999 });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/login', () => {
  test('returns a signed JWT for valid credentials', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: USERS.supervisor, password: PASSWORD });
    expect(res.status).toBe(200);
    const payload = jwt.verify(res.body.data.token, config.jwt.secret);
    expect(payload).toMatchObject({ role: 'supervisor' });
    expect(res.body.data.user.role).toBe('supervisor');
  });

  test('accepts the email in any letter case', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: USERS.operator.toUpperCase(), password: PASSWORD });
    expect(res.status).toBe(200);
  });

  test('returns 401 for a wrong password', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: USERS.operator, password: 'wrong-password' });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Invalid email or password');
  });

  test('returns the same 401 message for an unknown email (no account probing)', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'nobody@example.com', password: PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Invalid email or password');
  });

  test('returns 400 when the body is missing fields', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: USERS.operator });
    expect(res.status).toBe(400);
  });

  test('returns 400 INVALID_JSON for a malformed JSON body', async () => {
    const res = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{"email": ');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });
});

describe('GET /api/auth/me and token checks', () => {
  test('returns the current user for a valid token', async () => {
    const token = await login('operator');
    const res = await request(app).get('/api/auth/me').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ email: USERS.operator, role: 'operator', productionLineId: 1 });
  });

  test('returns 401 without a token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  test('returns 401 for a token signed with another secret', async () => {
    const forged = jwt.sign({ sub: 1, role: 'supervisor' }, 'not-the-real-secret');
    const res = await request(app).get('/api/auth/me').set(auth(forged));
    expect(res.status).toBe(401);
  });

  test('returns 401 for an expired token', async () => {
    const expired = jwt.sign({ sub: 1, role: 'supervisor' }, config.jwt.secret, { expiresIn: -10 });
    const res = await request(app).get('/api/auth/me').set(auth(expired));
    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/expired/i);
  });

  test('returns 401 for a malformed Authorization header', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', 'Token abc');
    expect(res.status).toBe(401);
  });

  test('a deactivated user is rejected even with a previously valid token', async () => {
    const token = await login('operatorLine2');
    await pool.query('UPDATE users SET is_active = FALSE WHERE email = ?', [USERS.operatorLine2]);
    const me = await request(app).get('/api/auth/me').set(auth(token));
    expect(me.status).toBe(401);
    const relogin = await request(app).post('/api/auth/login').send({ email: USERS.operatorLine2, password: PASSWORD });
    expect(relogin.status).toBe(401);
    await pool.query('UPDATE users SET is_active = TRUE WHERE email = ?', [USERS.operatorLine2]);
  });
});
