// Bookmark queries. Does NOT own business logic — see routes/bookmarks.js and services/meal-planner.js.
const { pool } = require('./index');

async function addBookmark(userId, recipeId) {
  const result = await pool.query(
    `INSERT INTO user_bookmarks (user_id, recipe_id)
     VALUES ($1, $2)
     ON CONFLICT (user_id, recipe_id) DO UPDATE SET created_at = NOW()
     RETURNING *`,
    [userId, recipeId]
  );
  return result.rows[0];
}

async function removeBookmark(userId, recipeId) {
  const result = await pool.query(
    'DELETE FROM user_bookmarks WHERE user_id = $1 AND recipe_id = $2 RETURNING id',
    [userId, recipeId]
  );
  return result.rowCount > 0;
}

async function getUserBookmarks(userId) {
  const result = await pool.query(
    `SELECT ub.recipe_id, ub.created_at, r.name, r.prep_time_minutes, r.cook_time_minutes, r.protein_type, r.description, r.source_url, r.imported_at, r.ingredients, r.sourcing_standard
     FROM user_bookmarks ub
     JOIN recipes r ON r.id = ub.recipe_id
     WHERE ub.user_id = $1
     ORDER BY ub.created_at DESC`,
    [userId]
  );
  return result.rows;
}

async function getUserImportedRecipes(userId) {
  // Recipes imported by this user (via URL import) that are NOT bookmarked yet.
  // We track imported recipes by the source_url field set during import.
  // For now, return all recipes that have a source_url — treat as "imported" pool.
  const result = await pool.query(
    `SELECT id, name, prep_time_minutes, cook_time_minutes, protein_type, description, source_url, imported_at, ingredients, sourcing_standard
     FROM recipes
     WHERE source_url IS NOT NULL
     ORDER BY imported_at DESC`
  );
  return result.rows;
}

async function isBookmarked(userId, recipeId) {
  const result = await pool.query(
    'SELECT 1 FROM user_bookmarks WHERE user_id = $1 AND recipe_id = $2',
    [userId, recipeId]
  );
  return result.rowCount > 0;
}

async function getBookmarkedRecipeIds(userId) {
  const result = await pool.query(
    'SELECT recipe_id FROM user_bookmarks WHERE user_id = $1',
    [userId]
  );
  return result.rows.map(r => r.recipe_id);
}

module.exports = {
  addBookmark,
  removeBookmark,
  getUserBookmarks,
  getUserImportedRecipes,
  isBookmarked,
  getBookmarkedRecipeIds
};