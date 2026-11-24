/*
 * Create (or recreate) the MaintainIQ tables and load demo data.
 *
 *   npm run db:setup              -> database in DB_NAME
 *   NODE_ENV=test npm run db:setup -> database in DB_NAME_TEST
 *
 * The schema drops existing MaintainIQ tables first, so this refuses to run when
 * NODE_ENV=production unless ALLOW_DB_RESET=true is also set (for the very first deploy).
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
require('dotenv').config();

// Tables whose seeded rows are marked is_demo_seed (kept in sync with src/middleware/demo.js by tests).
const SEEDED_TABLES = ['production_lines', 'users', 'machines', 'work_orders', 'downtime_logs', 'energy_readings'];

async function setupDatabase({ database, silent = false } = {}) {
  const isTest = process.env.NODE_ENV === 'test';
  const dbName = database || (isTest ? process.env.DB_NAME_TEST || 'maintainiq_test' : process.env.DB_NAME || 'maintainiq');
  const seedPassword = process.env.SEED_PASSWORD || (isTest ? 'Password123!' : null);

  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DB_RESET !== 'true') {
    throw new Error('Refusing to reset a production database. Set ALLOW_DB_RESET=true if you really mean it.');
  }
  if (!seedPassword || seedPassword.length < 8) {
    throw new Error('Set SEED_PASSWORD (at least 8 characters) in .env: it becomes the demo users\' password.');
  }

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: dbName,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
    multipleStatements: true, // needed to run the .sql files; only used by this trusted script
  });

  try {
    const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'db', f), 'utf8');
    await conn.query(read('schema.sql'));
    await conn.query(read('seed.sql'));

    // Replace the placeholder hashes from seed.sql with a real bcrypt hash.
    const hash = await bcrypt.hash(seedPassword, isTest ? 4 : 10);
    await conn.query('UPDATE users SET password_hash = ?', [hash]);

    // Mark every seeded row so DEMO_MODE can protect the baseline demo data (src/middleware/demo.js).
    // Setting updated_at to itself keeps the seeded timestamps unchanged.
    for (const table of SEEDED_TABLES) {
      await conn.query(`UPDATE ${table} SET is_demo_seed = TRUE, updated_at = updated_at`);
    }

    if (!silent) {
      const [[counts]] = await conn.query(`
        SELECT (SELECT COUNT(*) FROM roles) AS roles, (SELECT COUNT(*) FROM production_lines) AS production_lines,
               (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM machines) AS machines,
               (SELECT COUNT(*) FROM work_orders) AS work_orders, (SELECT COUNT(*) FROM downtime_logs) AS downtime_logs,
               (SELECT COUNT(*) FROM energy_readings) AS energy_readings, (SELECT COUNT(*) FROM maintenance_notes) AS maintenance_notes`);
      console.log(`Database "${dbName}" ready:`, counts);
      console.log('Demo logins: supervisor@maintainiq.demo / operator@maintainiq.demo (password = SEED_PASSWORD)');
    }
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  setupDatabase().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { setupDatabase, SEEDED_TABLES };
