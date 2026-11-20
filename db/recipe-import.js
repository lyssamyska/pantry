// Save imported recipe from URL. Does NOT fetch the URL — see services/recipe-importer.js.
const { pool } = require('./index');
const { reconcileDietaryFlags } = require('../services/compliance');

async function saveImportedRecipe(data) {
  // Normalize ingredients: array of strings → array of {name, quantity}
  const ingredients = (data.ingredients || []).map(ing => {
    if (typeof ing === 'string') {
      const match = ing.trim().match(/^((?:\d+(?:\.\d+)?\s+)?\d+\s*\/\s*\d+|\d+(?:\.\d+)?|[½¼⅓⅔¾])\s*(.*)$/i);
      if (match) {
        const unitMatch = match[2].match(/^(cups?|c|tablespoons?|tbsp|tbs|teaspoons?|tsp|ounces?|oz|pounds?|lbs?|g|grams?|kg|milliliters?|ml|liters?|l|pints?|quarts?|gallons?|fl\s*oz|inches?|cloves?|bunches?|handfuls?)(?:\b\s*)(.*)$/i);
        if (unitMatch) {
          return { name: unitMatch[2].trim(), quantity: `${match[1]} ${unitMatch[1]}`.trim() };
        }
        if (match[2].trim()) return { name: match[2].trim(), quantity: match[1].trim() };
      }
      return { name: ing.trim(), quantity: '' };
    }
    return ing;
  });

  // Normalize instructions: array of strings
  const instructions = (data.instructions || []).map(i => typeof i === 'string' ? i.trim() : i);

  const servingsValue = data.servings ?? data.base_servings;
  const servingsMatch = String(servingsValue ?? '').match(/\d+(?:\.\d+)?/);
  const parsedServings = servingsMatch ? Math.round(Number(servingsMatch[0])) : 4;
  const baseServings = Number.isInteger(parsedServings) && parsedServings > 0 ? parsedServings : 4;

  // Gluten-free / sugar-free come only from the compliance check of the
  // ingredients actually being saved — never from the browser or page tags.
  const dietary_flags = reconcileDietaryFlags(Array.isArray(data.dietary_flags) ? data.dietary_flags : [], ingredients);

  const result = await pool.query(`
    INSERT INTO recipes (name, description, prep_time_minutes, cook_time_minutes, protein_type, dietary_flags, sourcing_standard, ingredients, instructions, tags, source_url, imported_at, base_servings)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), $12)
    RETURNING *
  `, [
    data.name || 'Untitled Recipe',
    data.description || '',
    data.prep_time_minutes || 0,
    data.cook_time_minutes || 0,
    data.protein_type || null,
    dietary_flags,
    data.source_standard || false,
    JSON.stringify(ingredients),
    JSON.stringify(instructions),
    data.tags || [],
    data.source_url || null,
    baseServings,
  ]);

  return result.rows[0];
}

module.exports = { saveImportedRecipe };
