// Production configuration checks in src/config/env.js. Each case loads a fresh copy of the module
// with a controlled environment. Empty strings count as "missing" (and stop dotenv filling them from .env).

const VALID_PRODUCTION = {
  NODE_ENV: 'production',
  JWT_SECRET: 'x'.repeat(48),
  DB_HOST: 'db.example.com',
  DB_USER: 'app_user',
  DB_PASSWORD: 'db-password',
  DB_NAME: 'maintainiq',
  DEMO_MODE: 'false',
  DEMO_PASSWORD: '',
};

function loadConfig(overrides) {
  const saved = { ...process.env };
  Object.assign(process.env, VALID_PRODUCTION, overrides);
  try {
    let config;
    jest.isolateModules(() => {
      config = require('../src/config/env');
    });
    return config;
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
}

describe('production configuration', () => {
  test('a complete production configuration loads', () => {
    const config = loadConfig({ DB_SSL: 'true' });
    expect(config.isProduction).toBe(true);
    expect(config.db).toMatchObject({ host: 'db.example.com', user: 'app_user', database: 'maintainiq', ssl: true });
  });

  test.each(['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'])('refuses to start when %s is missing', (name) => {
    expect(() => loadConfig({ [name]: '' })).toThrow(`Missing required environment variable ${name}`);
  });

  test('still refuses a short JWT secret', () => {
    expect(() => loadConfig({ JWT_SECRET: 'short' })).toThrow('JWT_SECRET must be at least 32 characters');
  });

  test('DEMO_MODE requires a DEMO_PASSWORD of at least 8 characters', () => {
    expect(() => loadConfig({ DEMO_MODE: 'true', DEMO_PASSWORD: '' })).toThrow('DEMO_PASSWORD');
    expect(() => loadConfig({ DEMO_MODE: 'true', DEMO_PASSWORD: 'short' })).toThrow('DEMO_PASSWORD');
    expect(loadConfig({ DEMO_MODE: 'true', DEMO_PASSWORD: 'Public-Demo-1' }).demo).toEqual({ enabled: true, password: 'Public-Demo-1' });
  });

  test('production rate limits default to 10 failed logins and 10 registrations', () => {
    const config = loadConfig({ AUTH_LOGIN_MAX: '', AUTH_REGISTER_MAX: '' });
    expect(config.rateLimit).toEqual({ loginMax: 10, registerMax: 10 });
  });

  test('invalid rate-limit values are rejected', () => {
    expect(() => loadConfig({ AUTH_LOGIN_MAX: '0' })).toThrow('AUTH_LOGIN_MAX');
    expect(() => loadConfig({ AUTH_REGISTER_MAX: 'abc' })).toThrow('AUTH_REGISTER_MAX');
  });
});

describe('development configuration', () => {
  test('missing database settings fall back to local defaults outside production', () => {
    const config = loadConfig({ NODE_ENV: 'development', DB_HOST: '', DB_USER: '', DB_PASSWORD: '', DB_NAME: '' });
    expect(config.db).toMatchObject({ host: 'localhost', user: 'root', password: '', database: 'maintainiq' });
    expect(config.demo.enabled).toBe(false);
  });
});
