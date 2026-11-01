// Recipe queries. Does NOT own recipe generation logic — see services/meal-planner.js.
const { pool } = require('./index');

async function getAllRecipes() {
  const result = await pool.query('SELECT * FROM recipes ORDER BY name');
  return result.rows;
}

async function getRecipesByProtein(proteinType) {
  const result = await pool.query(
    'SELECT * FROM recipes WHERE protein_type = $1 AND prep_time_minutes <= 45 ORDER BY name',
    [proteinType]
  );
  return result.rows;
}

async function getRecipesByDietaryFlags(flags) {
  const result = await pool.query(
    'SELECT * FROM recipes WHERE dietary_flags && $1 AND prep_time_minutes <= 45 ORDER BY name',
    [flags]
  );
  return result.rows;
}

async function getSourcingCompliantRecipes() {
  const result = await pool.query(
    'SELECT * FROM recipes WHERE sourcing_standard = true AND prep_time_minutes <= 45 ORDER BY name'
  );
  return result.rows;
}

async function getRecipesForMealPlan(options = {}) {
  const { proteinTypes = [], dietaryFlags = [], maxPrepTime = 45, limit = null } = options;
  let query = 'SELECT * FROM recipes WHERE prep_time_minutes <= $1';
  const params = [maxPrepTime];
  let paramIndex = 2;

  if (proteinTypes.length > 0) {
    query += ` AND protein_type = $${paramIndex}`;
    params.push(proteinTypes[0]);
    paramIndex++;
  }

  if (dietaryFlags.length > 0) {
    query += ` AND dietary_flags && $${paramIndex}`;
    params.push(dietaryFlags);
    paramIndex++;
  }

  query += ' ORDER BY RANDOM()';
  if (limit != null) {
    query += ` LIMIT $${paramIndex}`;
    params.push(limit);
  }

  const result = await pool.query(query, params);
  return result.rows;
}

async function getRecipeById(id) {
  const result = await pool.query('SELECT * FROM recipes WHERE id = $1', [id]);
  return result.rows[0];
}

async function countRecipes() {
  const result = await pool.query('SELECT COUNT(*) FROM recipes');
  return parseInt(result.rows[0].count);
}

const DISCOVERY_SELECT = `SELECT r.id, r.name, r.description, r.prep_time_minutes, r.cook_time_minutes,
        r.protein_type, r.dietary_flags, r.sourcing_standard, r.source_url, r.imported_at`;

// Discovery recipes for the planner Discover panel.
// Splits results into three buckets: bookmarks (priority),
// imported URLs, and curated fallbacks. Recipes already in the user's
// past meal plans are excluded from imported + curated (anonymous users
// skip that filter).
async function getDiscoveryRecipes(userId, limit = 12) {
  let alreadyTried = [];
  if (userId) {
    const tried = await pool.query(
      `SELECT DISTINCT (day_obj->>'recipe_id')::int AS recipe_id
       FROM meal_plans mp, jsonb_array_elements(mp.days) AS day_obj
       WHERE mp.user_id = $1
         AND day_obj->>'recipe_id' IS NOT NULL`,
      [userId]
    );
    alreadyTried = tried.rows.map(r => r.recipe_id).filter(id => id != null);
  }

  // Bucket 1: user's bookmarks (priority, still surfaced even if "tried")
  let bookmarked = [];
  if (userId) {
    const r = await pool.query(
      `${DISCOVERY_SELECT}, 'bookmark' AS origin
       FROM user_bookmarks ub
       JOIN recipes r ON r.id = ub.recipe_id
       WHERE ub.user_id = $1
       ORDER BY ub.created_at DESC
       LIMIT $2`,
      [userId, limit]
    );
    bookmarked = r.rows;
  }

  const bookmarkedIds = bookmarked.map(b => b.id);

  // Bucket 2: imported recipes minus already-tried (and minus bookmarks to keep tabs disjoint)
  const importExcluded = [...new Set([...alreadyTried, ...bookmarkedIds])];
  const importQuery = importExcluded.length > 0
    ? `${DISCOVERY_SELECT}, 'import' AS origin
       FROM recipes r
       WHERE r.source_url IS NOT NULL
         AND r.id <> ALL($1::int[])
       ORDER BY r.imported_at DESC
       LIMIT $2`
    : `${DISCOVERY_SELECT}, 'import' AS origin
       FROM recipes r
       WHERE r.source_url IS NOT NULL
       ORDER BY r.imported_at DESC
       LIMIT $1`;
  const importParams = importExcluded.length > 0 ? [importExcluded, limit] : [limit];
  const importedResult = await pool.query(importQuery, importParams);
  const imported = importedResult.rows;
  const importedIds = imported.map(b => b.id);

  // Bucket 3: curated random, minus already-tried and minus previous buckets
  const curatedExcluded = [...new Set([...alreadyTried, ...bookmarkedIds, ...importedIds])];
  const curatedQuery = curatedExcluded.length > 0
    ? `${DISCOVERY_SELECT}, 'curated' AS origin
       FROM recipes r
       WHERE r.id <> ALL($1::int[])
       ORDER BY RANDOM()
       LIMIT $2`
    : `${DISCOVERY_SELECT}, 'curated' AS origin
       FROM recipes r
       ORDER BY RANDOM()
       LIMIT $1`;
  const curatedParams = curatedExcluded.length > 0 ? [curatedExcluded, limit] : [limit];
  const curatedResult = await pool.query(curatedQuery, curatedParams);
  const curated = curatedResult.rows;

  return { bookmarked, imported, curated };
}

module.exports = {
  getAllRecipes,
  getRecipesByProtein,
  getRecipesByDietaryFlags,
  getSourcingCompliantRecipes,
  getRecipesForMealPlan,
  getRecipeById,
  countRecipes,
  getDiscoveryRecipes
};