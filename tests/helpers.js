const request = require('supertest');
const app = require('../src/app');
const { pool } = require('../src/config/db');
const { setupDatabase } = require('../scripts/db-setup');

const PASSWORD = process.env.SEED_PASSWORD || 'Password123!';

// Seeded accounts (see db/seed.sql)
const USERS = {
  supervisor: 'supervisor@maintainiq.demo', // all lines
  operator: 'operator@maintainiq.demo', // line 1 (Press Shop): machines 1-3
  operatorLine2: 'sneha.patil@maintainiq.demo', // line 2 (CNC): machines 4-6
};

async function login(who) {
  const res = await request(app).post('/api/auth/login').send({ email: USERS[who], password: PASSWORD });
  if (res.status !== 200) throw new Error(`Login failed for ${who}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data.token;
}

/** Log in as every seeded role; returns { supervisor, operator, operatorLine2 } tokens. */
async function loginAll() {
  const entries = await Promise.all(Object.keys(USERS).map(async (k) => [k, await login(k)]));
  return Object.fromEntries(entries);
}

const auth = (token) => ({ Authorization: `Bearer ${token}` });

/** Reset the test database so each file starts from the same seed data. */
const resetDb = () => setupDatabase({ silent: true });

module.exports = { app, request, pool, PASSWORD, USERS, login, loginAll, auth, resetDb };
