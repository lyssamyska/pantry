// Adds source_url and imported_at to recipes table for imported recipe tracking.
module.exports = {
  name: 'add_recipe_source_url',
  up: async (client) => {
    await client.query(`
      ALTER TABLE recipes
      ADD COLUMN IF NOT EXISTS source_url VARCHAR(2048),
      ADD COLUMN IF NOT EXISTS imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_recipes_source_url ON recipes (source_url)`);
  },
};
