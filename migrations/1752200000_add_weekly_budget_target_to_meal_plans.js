module.exports = {
  name: 'add_weekly_budget_target_to_meal_plans',
  up: async (client) => {
    await client.query(`
      ALTER TABLE meal_plans
      ADD COLUMN IF NOT EXISTS weekly_budget_target NUMERIC(10,2)
    `);
  }
};
