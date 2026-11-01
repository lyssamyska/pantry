module.exports = {
  name: 'pantry_items',
  up: async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS pantry_items (
        id          SERIAL PRIMARY KEY,
        user_id     INTEGER NOT NULL,
        name        VARCHAR(255) NOT NULL,
        quantity    VARCHAR(50)  NOT NULL,
        unit        VARCHAR(50)  NOT NULL,
        expires_at  DATE,
        added_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_pantry_items_user ON pantry_items (user_id)`
    );

    // Seed sample rows for the test user (user_id = 1) so GET /api/pantry/1
    // returns non-empty data immediately after migration.
    await client.query(`
      INSERT INTO pantry_items (user_id, name, quantity, unit, expires_at)
      SELECT 1, 'Olive oil', '1', 'bottle', NULL
      WHERE NOT EXISTS (
        SELECT 1 FROM pantry_items WHERE user_id = 1 AND name = 'Olive oil'
      )
    `);
    await client.query(`
      INSERT INTO pantry_items (user_id, name, quantity, unit, expires_at)
      SELECT 1, 'Garlic', '6', 'cloves', NULL
      WHERE NOT EXISTS (
        SELECT 1 FROM pantry_items WHERE user_id = 1 AND name = 'Garlic'
      )
    `);
    await client.query(`
      INSERT INTO pantry_items (user_id, name, quantity, unit, expires_at)
      SELECT 1, 'Spinach', '5', 'oz', CURRENT_DATE + INTERVAL '5 days'
      WHERE NOT EXISTS (
        SELECT 1 FROM pantry_items WHERE user_id = 1 AND name = 'Spinach'
      )
    `);
  }
};
