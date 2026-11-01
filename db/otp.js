const { pool } = require('./index');
const crypto = require('crypto');

async function createOtp(email) {
  const code = String(crypto.randomInt(100000, 999999));
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min
  await pool.query(
    'INSERT INTO otp_codes (email, code, expires_at) VALUES (LOWER($1), $2, $3)',
    [email, code, expiresAt]
  );
  return code;
}

async function verifyOtp(email, code) {
  const result = await pool.query(
    `SELECT id FROM otp_codes
     WHERE LOWER(email) = LOWER($1)
       AND code = $2
       AND expires_at > NOW()
       AND used = false
     ORDER BY created_at DESC
     LIMIT 1`,
    [email, code]
  );
  if (result.rows.length === 0) return false;
  await pool.query('UPDATE otp_codes SET used = true WHERE id = $1', [result.rows[0].id]);
  return true;
}

async function upsertUser(email) {
  await pool.query(
    'INSERT INTO users (email) VALUES (LOWER($1)) ON CONFLICT DO NOTHING',
    [email]
  );
  const result = await pool.query(
    'SELECT id FROM users WHERE LOWER(email) = LOWER($1)',
    [email]
  );
  return result.rows[0].id;
}

module.exports = { createOtp, verifyOtp, upsertUser };
