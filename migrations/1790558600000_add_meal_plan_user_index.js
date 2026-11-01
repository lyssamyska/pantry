module.exports = {
  name: 'add_meal_plan_user_index',
  up: async (client) => {
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_meal_plans_user_created_at
      ON meal_plans (user_id, created_at DESC)
    `);
  },
};
