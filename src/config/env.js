require('dotenv').config();

const isTest = process.env.NODE_ENV === 'test';
const isProduction = process.env.NODE_ENV === 'production';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}. See .env.example.`);
  return value;
}

const config = {
  isTest,
  isProduction,
  port: Number(process.env.PORT) || 3000,
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    // Tests always run against a separate database so they can never wipe real data.
    database: isTest ? (process.env.DB_NAME_TEST || 'maintainiq_test') : (process.env.DB_NAME || 'maintainiq'),
    ssl: process.env.DB_SSL === 'true',
  },
  jwt: {
    secret: isTest ? (process.env.JWT_SECRET || 'test-only-secret') : required('JWT_SECRET'),
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  },
  corsOrigins: (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
};

if (isProduction && config.jwt.secret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters in production.');
}

module.exports = config;
