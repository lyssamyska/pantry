module.exports = {
  name: 'pantry_source',
  up: async (client) => {
    await client.query(`
      ALTER TABLE pantry_items
      ADD COLUMN IF NOT EXISTS source VARCHAR(16) NOT NULL DEFAULT 'pantry'
    `);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_pantry_items_user_source ON pantry_items (user_id, source)`
    );
  }
};
