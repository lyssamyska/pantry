module.exports = {
  name: 'planner_servings_package_sizes',
  up: async (client) => {
    await client.query(`
      ALTER TABLE recipes
      ADD COLUMN IF NOT EXISTS base_servings INTEGER NOT NULL DEFAULT 4
    `);
    await client.query(`
      ALTER TABLE meal_plans
      ADD COLUMN IF NOT EXISTS servings INTEGER NOT NULL DEFAULT 2
    `);
    await client.query(`
      ALTER TABLE price_entries
      ADD COLUMN IF NOT EXISTS package_quantity DECIMAL(10,3),
      ADD COLUMN IF NOT EXISTS package_unit VARCHAR(50),
      ADD COLUMN IF NOT EXISTS price_is_estimate BOOLEAN NOT NULL DEFAULT true
    `);
    await client.query(`
      UPDATE price_entries pe
      SET price = 6.00,
          package_quantity = 4,
          package_unit = 'cup',
          price_is_estimate = true
      FROM ingredients i, stores s
      WHERE pe.ingredient_id = i.id
        AND pe.store_id = s.id
        AND i.name = 'chicken broth'
        AND s.slug = 'heb'
    `);
  }
};
