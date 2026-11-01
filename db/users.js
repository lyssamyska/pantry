const { pool } = require('./index');

async function getUserById(id) {
  const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
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

module.exports = { getUserById, saveOnboardingPreferences };
