const config = require('../config/env');
const { query } = require('../config/db');
const { HttpError } = require('../utils/httpError');
const asyncHandler = require('../utils/asyncHandler');

/*
 * Public demo protection (active only when DEMO_MODE=true).
 *
 * Every row loaded by `npm run db:setup` is marked is_demo_seed = TRUE. In demo mode:
 *  - seeded demo ACCOUNTS cannot be changed at all (no deactivation, demotion, promotion or line change),
 *  - seeded RECORDS cannot be deleted (they can still be edited; the nightly reset restores them),
 *  - nobody can create a new account on the reserved demo email domain.
 * Visitors can still try every workflow, including deleting, on records and users they create themselves.
 */

const DEMO_EMAIL_DOMAIN = '@maintainiq.demo';

/** Accounts advertised on the login page (all seeded, so all protected). */
const DEMO_ACCOUNTS = [
  { email: 'supervisor@maintainiq.demo', label: 'Supervisor' },
  { email: 'operator@maintainiq.demo', label: 'Operator · Press Shop' },
];

// Table names are never taken from user input; this list is the only source.
const SEEDED_TABLES = ['production_lines', 'users', 'machines', 'work_orders', 'downtime_logs', 'energy_readings'];

const demoProtected = (message) => new HttpError(403, 'DEMO_PROTECTED', message);

async function isSeeded(table, id) {
  if (!SEEDED_TABLES.includes(table)) throw new Error(`Unknown seeded table ${table}`);
  const rows = await query(`SELECT is_demo_seed FROM ${table} WHERE id = ?`, [id]);
  return Boolean(rows[0] && rows[0].is_demo_seed);
}

/** Middleware for DELETE /:id routes: seeded demo records cannot be deleted in demo mode. */
function protectSeededRecord(table, label) {
  if (!SEEDED_TABLES.includes(table)) throw new Error(`Unknown seeded table ${table}`);
  return asyncHandler(async (req, res, next) => {
    if (config.demo.enabled && (await isSeeded(table, req.params.id))) {
      throw demoProtected(`This ${label} is part of the demo dataset and cannot be deleted. Create your own ${label} to try deleting.`);
    }
    next();
  });
}

/** Middleware for PATCH /api/users/:id: seeded demo accounts cannot be modified in demo mode. */
const protectDemoAccount = asyncHandler(async (req, res, next) => {
  if (config.demo.enabled && (await isSeeded('users', req.params.id))) {
    throw demoProtected('Demo accounts cannot be changed in the public demo. Create a new user to try editing.');
  }
  next();
});

/** Throws when demo mode is on and the email uses the reserved demo domain. */
function assertNotReservedEmail(email) {
  if (config.demo.enabled && String(email).toLowerCase().endsWith(DEMO_EMAIL_DOMAIN)) {
    throw demoProtected(`Email addresses ending in ${DEMO_EMAIL_DOMAIN} are reserved for the built-in demo accounts.`);
  }
}

/** Data for GET /api/public/demo (used by the login page). The demo password is intentionally public. */
function publicDemoInfo() {
  if (!config.demo.enabled) return { enabled: false };
  return { enabled: true, password: config.demo.password, accounts: DEMO_ACCOUNTS };
}

module.exports = { protectSeededRecord, protectDemoAccount, assertNotReservedEmail, publicDemoInfo, DEMO_ACCOUNTS, SEEDED_TABLES };
