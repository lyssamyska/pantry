// user_bookmarks: persists user bookmarked recipes for meal plan weighting.
module.exports = {
  name: 'user_bookmarks',
  up: async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_bookmarks (
        id          SERIAL PRIMARY KEY,
        user_id     INTEGER,
        recipe_id   INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(user_id, recipe_id)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_user_bookmarks_user ON user_bookmarks(user_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_user_bookmarks_recipe ON user_bookmarks(recipe_id)`);
  },
};
