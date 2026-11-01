const RECIPE = {
  name: 'Sweet Potato Meatballs',
  description: 'Tender ground turkey meatballs with roasted sweet potato, herbs, and garlic',
  prep_time_minutes: 20,
  cook_time_minutes: 25,
  protein_type: 'turkey',
  dietary_flags: ['gluten-free', 'dairy-free'],
  sourcing_standard: true,
  ingredients: [
    { name: 'sweet potato meatballs', quantity: '4' },
    { name: 'ground turkey', quantity: '1 lb', sourcing_hint: 'pastured' },
    { name: 'sweet potato', quantity: '1 medium' },
    { name: 'egg', quantity: '1' },
    { name: 'garlic', quantity: '2 cloves' },
    { name: 'parsley', quantity: '2 tbsp' },
    { name: 'olive oil', quantity: '1 tbsp' }
  ],
  instructions: [
    'Roast sweet potato until tender and mash',
    'Mix sweet potato with turkey, egg, garlic, and parsley',
    'Shape into meatballs and sear in olive oil',
    'Bake at 400°F until cooked through, about 15 minutes'
  ],
  tags: ['dinner', 'healthy', 'meal-prep']
};

module.exports = {
  name: 'seed_sweet_potato_meatballs',
  up: async (client) => {
    await client.query(`
      INSERT INTO recipes (name, description, prep_time_minutes, cook_time_minutes, protein_type, dietary_flags, sourcing_standard, ingredients, instructions, tags)
      SELECT $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10
      WHERE NOT EXISTS (SELECT 1 FROM recipes WHERE name = $11)
    `, [
      RECIPE.name,
      RECIPE.description,
      RECIPE.prep_time_minutes,
      RECIPE.cook_time_minutes,
      RECIPE.protein_type,
      RECIPE.dietary_flags,
      RECIPE.sourcing_standard,
      JSON.stringify(RECIPE.ingredients),
      JSON.stringify(RECIPE.instructions),
      RECIPE.tags,
      RECIPE.name
    ]);
  }
};
