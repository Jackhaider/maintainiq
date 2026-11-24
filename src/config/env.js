require('dotenv').config();

const isTest = process.env.NODE_ENV === 'test';
const isProduction = process.env.NODE_ENV === 'production';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}. See .env.example.`);
  return value;
}

/** In production a missing database setting is a deployment mistake: fail at start-up instead of
 *  silently falling back to localhost and reporting "database unreachable" later. */
const dbSetting = (name, devDefault) => (isProduction ? required(name) : process.env[name] || devDefault);

/** Positive whole number from the environment, or the fallback. */
function positiveInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${name} must be a positive whole number.`);
  return n;
}

const config = {
  isTest,
  isProduction,
  port: Number(process.env.PORT) || 3000,
  db: {
    host: dbSetting('DB_HOST', 'localhost'),
    port: Number(process.env.DB_PORT) || 3306,
    user: dbSetting('DB_USER', 'root'),
    password: dbSetting('DB_PASSWORD', ''),
    // Tests always run against a separate database so they can never wipe real data.
    database: isTest ? (process.env.DB_NAME_TEST || 'maintainiq_test') : dbSetting('DB_NAME', 'maintainiq'),
    ssl: process.env.DB_SSL === 'true',
  },
  jwt: {
    secret: isTest ? (process.env.JWT_SECRET || 'test-only-secret') : required('JWT_SECRET'),
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  },
  corsOrigins: (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  // Brute-force and sign-up spam protection for the public auth endpoints (per client IP).
  // Tests get a very high default so the normal suites are unaffected; tests/rateLimit.test.js sets low limits.
  rateLimit: {
    loginMax: positiveInt('AUTH_LOGIN_MAX', isTest ? 10000 : 10), // failed logins per 15 minutes
    registerMax: positiveInt('AUTH_REGISTER_MAX', isTest ? 10000 : 10), // registrations per hour
  },
  // Public demo mode: the seeded demo accounts and records are protected (see src/middleware/demo.js),
  // and the login page shows the shared demo password. DEMO_PASSWORD is deliberately public.
  demo: {
    enabled: process.env.DEMO_MODE === 'true',
    password: process.env.DEMO_PASSWORD || null,
  },
};

if (isProduction && config.jwt.secret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters in production.');
}
if (isProduction && config.demo.enabled && (!config.demo.password || config.demo.password.length < 8)) {
  throw new Error('DEMO_PASSWORD (at least 8 characters) is required when DEMO_MODE=true in production.');
}

module.exports = config;
