// Database access layer. Single Pool instance — all queries go through named functions.
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});

pool.on('error', (err) => {
  console.error('[pg pool] idle client error:', err && err.message);
});

module.exports = { pool };