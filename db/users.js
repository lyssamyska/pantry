const { pool } = require('./index');

async function getUserById(id) {
  const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function getUserByEmail(email) {
  const result = await pool.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [email]);
  return result.rows[0] || null;
}

async function createUser(email, passwordHash) {
  const result = await pool.query(
    'INSERT INTO users (email, password_hash) VALUES (LOWER($1), $2) RETURNING id, email',
    [email, passwordHash]
  );
  return result.rows[0];
}

async function setPasswordHash(email, passwordHash) {
  const result = await pool.query(
    'UPDATE users SET password_hash = $2, updated_at = NOW() WHERE LOWER(email) = LOWER($1) RETURNING id',
    [email, passwordHash]
  );
  return result.rows[0] || null;
}

async function saveOnboardingPreferences(userId, dietPreferences, mealCountDefaults) {
  await pool.query(
    `UPDATE users
     SET diet_preferences = $2, meal_count_defaults = $3, onboarding_completed = TRUE,
         updated_at = NOW()
     WHERE id = $1`,
    [userId, JSON.stringify(dietPreferences), JSON.stringify(mealCountDefaults)]
  );
}

module.exports = { getUserById, getUserByEmail, createUser, setPasswordHash, saveOnboardingPreferences };
