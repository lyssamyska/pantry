// Pantry queries. Does NOT own business logic — see routes/pantry.js.
const { pool } = require('./index');

const ALLOWED_SOURCES = ['pantry', 'csa'];

async function getPantryItems(userId) {
  const result = await pool.query(
    `SELECT id, user_id, name, quantity, unit, expires_at, source, added_at
     FROM pantry_items
     WHERE user_id = $1
     ORDER BY added_at DESC`,
    [userId]
  );
  return result.rows;
}

async function getCsaItems(userId) {
  const result = await pool.query(
    `SELECT id, user_id, name, quantity, unit, expires_at, source, added_at
     FROM pantry_items
     WHERE user_id = $1 AND source = 'csa'
     ORDER BY added_at DESC`,
    [userId]
  );
  return result.rows;
}

async function addPantryItem(userId, { name, quantity, unit, expires_at, source }) {
  const finalSource = ALLOWED_SOURCES.includes(source) ? source : 'pantry';
  const result = await pool.query(
    `INSERT INTO pantry_items (user_id, name, quantity, unit, expires_at, source)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, user_id, name, quantity, unit, expires_at, source, added_at`,
    [userId, name, quantity, unit, expires_at || null, finalSource]
  );
  return result.rows[0];
}

async function updatePantryItem(userId, itemId, { name, quantity, unit }) {
  const result = await pool.query(
    `UPDATE pantry_items
     SET name = $3, quantity = $4, unit = $5
     WHERE user_id = $1 AND id = $2
     RETURNING id, user_id, name, quantity, unit, expires_at, source, added_at`,
    [userId, itemId, name, quantity, unit]
  );
  return result.rows[0] || null;
}

async function deletePantryItem(userId, itemId) {
  const result = await pool.query(
    `DELETE FROM pantry_items
     WHERE user_id = $1 AND id = $2
     RETURNING id`,
    [userId, itemId]
  );
  return result.rows[0] || null;
}

module.exports = { getPantryItems, getCsaItems, addPantryItem, updatePantryItem, deletePantryItem, ALLOWED_SOURCES };
