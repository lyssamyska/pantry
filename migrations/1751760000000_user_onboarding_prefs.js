module.exports = {
  name: 'user_onboarding_prefs',
  up: async (client) => {
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS diet_preferences JSONB NOT NULL DEFAULT '[]'`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS meal_count_defaults JSONB NOT NULL DEFAULT '{}'`);
  }
};
