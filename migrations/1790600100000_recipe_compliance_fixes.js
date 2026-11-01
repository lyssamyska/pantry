// Run every seeded recipe through services/compliance.js:
//   - swap soy sauce → coconut aminos and oyster sauce → gluten-free oyster
//     sauce where that is the only gluten source;
//   - Lamb Flatiron: farro → quinoa (it was labeled gluten-free);
//   - recompute gluten-free / sugar-free from the ingredients (adds the new
//     sugar-free flag); other flags (dairy-free, vegetarian…) are kept.
// Rows are matched by name, so this also corrects any duplicate seed rows.
const { getSeedRecipes } = require('../lib/seed-recipes');

module.exports = {
  name: 'recipe_compliance_fixes',
  up: async (client) => {
    let updated = 0;
    for (const recipe of getSeedRecipes()) {
      const result = await client.query(
        `UPDATE recipes
         SET description = $2, ingredients = $3::jsonb, instructions = $4::jsonb, dietary_flags = $5
         WHERE name = $1 AND source_url IS NULL`,
        [
          recipe.name,
          recipe.description,
          JSON.stringify(recipe.ingredients),
          JSON.stringify(recipe.instructions),
          recipe.dietary_flags,
        ]
      );
      updated += result.rowCount;
    }
    console.log(`Compliance fixes applied to ${updated} seeded recipe rows`);
  },
};
