// Runs once before all test files: rebuild the TEST database (never the dev/prod one) from schema + seed.
process.env.NODE_ENV = 'test';
const { setupDatabase } = require('../scripts/db-setup');

module.exports = async () => {
  await setupDatabase({ silent: true });
};
