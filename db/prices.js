// Price lookup queries for cross-store price comparison.
const { pool } = require('./index');
const { SUPPORTED_AUSTIN_RETAILER_SLUGS } = require('../lib/austin-retailers');

const supportedStoreSlugs = [...SUPPORTED_AUSTIN_RETAILER_SLUGS];
const storeSelectionOrder = `
      CASE WHEN s.slug = 'heb' THEN 0 ELSE 1 END,
      pe.price ASC,
      s.slug ASC,
      s.name ASC
    `;

async function getPricesByIngredient(ingredientId) {
  const result = await pool.query(`
    SELECT pe.*, s.name as store_name, s.slug as store_slug, s.logo_color, i.name as ingredient_name
    FROM price_entries pe
    JOIN stores s ON pe.store_id = s.id
    JOIN ingredients i ON pe.ingredient_id = i.id
    WHERE pe.ingredient_id = $1 AND s.slug = ANY($2)
    ORDER BY ${storeSelectionOrder}
  `, [ingredientId, supportedStoreSlugs]);
  return result.rows;
}

async function getBestPrice(ingredientId) {
  const result = await pool.query(`
    SELECT pe.*, s.name as store_name, s.slug as store_slug, s.logo_color
    FROM price_entries pe
    JOIN stores s ON pe.store_id = s.id
    WHERE pe.ingredient_id = $1 AND s.slug = ANY($2)
    ORDER BY ${storeSelectionOrder}
    LIMIT 1
  `, [ingredientId, supportedStoreSlugs]);
  return result.rows[0] || null;
}

async function getPricesByStore(storeId) {
  const result = await pool.query(`
    SELECT pe.*, i.name as ingredient_name, i.category, i.unit as base_unit, i.sourcing_hint
    FROM price_entries pe
    JOIN ingredients i ON pe.ingredient_id = i.id
    JOIN stores s ON pe.store_id = s.id
    WHERE pe.store_id = $1 AND s.slug = ANY($2)
    ORDER BY i.category, i.name
  `, [storeId, supportedStoreSlugs]);
  return result.rows;
}

async function getIngredientByName(name) {
  const result = await pool.query(
    `SELECT * FROM ingredients WHERE LOWER(name) = LOWER($1)`,
    [name]
  );
  return result.rows[0] || null;
}

async function upsertIngredient(name, category, unit, sourcingHint) {
  const result = await pool.query(`
    INSERT INTO ingredients (name, category, unit, sourcing_hint)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (name) DO UPDATE SET
      category = EXCLUDED.category,
      unit = EXCLUDED.unit,
      sourcing_hint = EXCLUDED.sourcing_hint
    RETURNING *
  `, [name, category, unit, sourcingHint]);
  return result.rows[0];
}

async function getAllIngredients() {
  const result = await pool.query(`
    SELECT i.*,
      best.price as best_price,
      s.name as best_store,
      s.slug as best_store_slug,
      s.logo_color as best_store_color,
      best.package_quantity as best_package_quantity,
      best.package_unit as best_package_unit,
      best.price_is_estimate as best_price_is_estimate,
      best.package_label as best_package_label
    FROM ingredients i
    LEFT JOIN LATERAL (
      SELECT price, store_id, package_quantity, package_unit, price_is_estimate, unit AS package_label FROM price_entries
      JOIN stores store ON price_entries.store_id = store.id
      WHERE ingredient_id = i.id AND store.slug = ANY($1)
      ORDER BY CASE WHEN store.slug = 'heb' THEN 0 ELSE 1 END,
               price ASC, store.slug ASC, store.name ASC
      LIMIT 1
    ) best ON true
    LEFT JOIN stores s ON best.store_id = s.id
    ORDER BY i.category, i.name
  `, [supportedStoreSlugs]);
  return result.rows;
}

async function getAllStorePrices() {
  const result = await pool.query(`
    SELECT i.name AS ingredient_name,
           s.name AS store_name,
           s.slug AS store_slug,
           s.logo_color,
           pe.price,
           pe.package_quantity,
           pe.package_unit,
           pe.price_is_estimate,
           pe.unit AS package_label
    FROM ingredients i
    JOIN price_entries pe ON pe.ingredient_id = i.id
    JOIN stores s ON pe.store_id = s.id
    WHERE s.slug = ANY($1)
    ORDER BY i.name,
             CASE WHEN s.slug = 'heb' THEN 0 ELSE 1 END,
             pe.price ASC, s.slug ASC, s.name ASC
  `, [supportedStoreSlugs]);
  return result.rows;
}

module.exports = {
  getPricesByIngredient,
  getBestPrice,
  getPricesByStore,
  getIngredientByName,
  upsertIngredient,
  getAllIngredients,
  getAllStorePrices
};
