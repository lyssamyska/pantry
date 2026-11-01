// The seeded recipe catalog, with compliance fixes applied.
//
// The original seed lists live in the (already-applied) seed migrations and
// are left as history. Fixes go here so that:
//   - migration 1790600100000 can apply them to existing databases, and
//   - tests can audit exactly what the database ends up holding.
const { reconcileDietaryFlags } = require('../services/compliance');

const SEED_MIGRATIONS = [
  '1751657000000_seed_recipes',
  '1751658500000_seed_missing_fish',
  '1790558500000_seed_sweet_potato_meatballs',
];

// Clean like-for-like swaps that keep the dish recognizable. Applied to
// ingredient names, instructions, and the description.
const SWAPS = {
  'Korean BBQ Beef Bowl': [['soy sauce', 'coconut aminos']],
  'Mongolian Beef': [['soy sauce', 'coconut aminos']],
  'Chicken Stir-Fry with Bok Choy': [['soy sauce', 'coconut aminos'], ['oyster sauce', 'gluten-free oyster sauce']],
  'Thai Basil Chicken': [['soy sauce', 'coconut aminos'], ['oyster sauce', 'gluten-free oyster sauce']],
  // Was labeled gluten-free but served over farro (wheat).
  'Lamb Flatiron with Chimichurri': [['farro', 'quinoa']],
};

function swapText(text, swaps) {
  return swaps.reduce((current, [from, to]) => {
    const pattern = new RegExp(`(?<![\\w-])${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'gi');
    return current.replace(pattern, to);
  }, String(text || ''));
}

function applyComplianceFixes(recipe) {
  const swaps = SWAPS[recipe.name] || [];
  const ingredients = (recipe.ingredients || []).map((ingredient) =>
    typeof ingredient === 'string' ? swapText(ingredient, swaps) : { ...ingredient, name: swapText(ingredient.name, swaps) }
  );
  return {
    ...recipe,
    description: swapText(recipe.description, swaps),
    ingredients,
    instructions: (recipe.instructions || []).map((step) => swapText(step, swaps)),
    dietary_flags: reconcileDietaryFlags(recipe.dietary_flags, ingredients),
  };
}

function getOriginalSeedRecipes() {
  return SEED_MIGRATIONS.flatMap((name) => require(`../migrations/${name}`).RECIPES);
}

function getSeedRecipes() {
  return getOriginalSeedRecipes().map(applyComplianceFixes);
}

module.exports = { SWAPS, applyComplianceFixes, getOriginalSeedRecipes, getSeedRecipes };
