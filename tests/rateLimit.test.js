// Login and registration rate limiting. Low limits are set for this file only
// (Jest gives every test file its own copy of process.env).
process.env.AUTH_LOGIN_MAX = '3';
process.env.AUTH_REGISTER_MAX = '2';

const { app, request, pool, PASSWORD, USERS, resetDb } = require('./helpers');

beforeAll(() => resetDb());
afterAll(() => pool.end());

const login = (password) => request(app).post('/api/auth/login').send({ email: USERS.supervisor, password });

describe('POST /api/auth/login rate limit (failed attempts per IP)', () => {
  test('successful sign-ins are not counted', async () => {
    for (let i = 0; i < 6; i++) {
      expect((await login(PASSWORD)).status).toBe(200);
    }
  });

  test('the first 3 failed attempts get a normal 401', async () => {
    for (let i = 0; i < 3; i++) {
      expect((await login('wrong-password')).status).toBe(401);
    }
  });

  test('the next attempt gets 429 RATE_LIMITED in the API error format, with RateLimit headers', async () => {
    const res = await login('wrong-password');
    expect(res.status).toBe(429);
    expect(res.body.error).toEqual({
      code: 'RATE_LIMITED',
      message: 'Too many failed sign-in attempts. Please wait 15 minutes and try again.',
    });
    expect(res.headers.ratelimit).toBeDefined();
    expect(res.headers['ratelimit-policy']).toBeDefined();
  });

  test('once limited, even the correct password is refused (no more guessing)', async () => {
    expect((await login(PASSWORD)).status).toBe(429);
  });
});

describe('POST /api/auth/register rate limit (all attempts per IP)', () => {
  const register = (email) =>
    request(app).post('/api/auth/register').send({ fullName: 'Rate Test', email, password: 'RateTest123!', productionLineId: 1 });

  test('allows 2 attempts, counting invalid ones too', async () => {
    expect((await register('first@example.com')).status).toBe(201);
    expect((await request(app).post('/api/auth/register').send({})).status).toBe(400);
  });

  test('the 3rd attempt gets 429 and no account is created', async () => {
    const res = await register('third@example.com');
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    const [rows] = await pool.query('SELECT id FROM users WHERE email = ?', ['third@example.com']);
    expect(rows).toHaveLength(0);
  });
});

describe('other endpoints are not rate limited', () => {
  test('health check and public data still respond', async () => {
    expect((await request(app).get('/api/health')).status).toBe(200);
    expect((await request(app).get('/api/public/production-lines')).status).toBe(200);
  });
});
