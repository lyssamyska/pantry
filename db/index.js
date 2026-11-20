// Database access layer. Single Pool instance — all queries go through named functions.
// Connects to Neon's pooled endpoint (DATABASE_URL); see lib/db-config.js.
const { Pool } = require('pg');
const { poolConfig, appDatabaseUrl } = require('../lib/db-config');

const pool = new Pool(poolConfig(appDatabaseUrl()));

pool.on('error', (err) => {
  console.error('[pg pool] idle client error:', err && err.message);
});

module.exports = { pool };
