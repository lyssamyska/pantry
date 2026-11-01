// Meal plan and grocery item queries.
const { pool } = require('./index');
const { computeDayPricing } = require('../services/meal-planner');
const pricesDb = require('./prices');
const pantryDb = require('./pantry-items');

async function createMealPlan(userId, planName, days, weeklyBudgetTarget = null, servings = 2) {
  const result = await pool.query(
    'INSERT INTO meal_plans (user_id, plan_name, days, weekly_budget_target, servings) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [userId, planName, JSON.stringify(days), weeklyBudgetTarget, servings]
  );
  return result.rows[0];
}

async function saveMealPlanSnapshot(userId, days, servings = 2, weeklyBudgetTarget = null, categoryItems = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const planResult = await client.query(
      'INSERT INTO meal_plans (user_id, plan_name, days, weekly_budget_target, servings) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [userId, 'Weekly Meal Plan', JSON.stringify(days), weeklyBudgetTarget, servings]
    );
    const savedPlan = planResult.rows[0];

    for (const [category, items] of Object.entries(categoryItems || {})) {
      await client.query(
        'INSERT INTO grocery_items (plan_id, category, items) VALUES ($1, $2, $3)',
        [savedPlan.id, category, JSON.stringify(items)]
      );
    }

    await client.query('COMMIT');
    return { plan: savedPlan, grocery_list: categoryItems || {} };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getMealPlan(id) {
  const result = await pool.query('SELECT * FROM meal_plans WHERE id = $1', [id]);
  return result.rows[0];
}

async function getMealPlanForUser(planId, userId) {
  const result = await pool.query(
    'SELECT * FROM meal_plans WHERE id = $1 AND user_id = $2',
    [planId, userId]
  );
  return result.rows[0];
}

async function saveGroceryList(planId, categoryItems) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM grocery_items WHERE plan_id = $1', [planId]);
    for (const [category, items] of Object.entries(categoryItems)) {
      await client.query(
        'INSERT INTO grocery_items (plan_id, category, items) VALUES ($1, $2, $3)',
        [planId, category, JSON.stringify(items)]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function saveMealPlanAndGroceryList(planId, days, categoryItems) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'UPDATE meal_plans SET days = $1 WHERE id = $2',
      [JSON.stringify(days), planId]
    );
    const currentCustomRows = await client.query(
      'SELECT items FROM grocery_items WHERE plan_id = $1 AND category = $2 FOR UPDATE',
      [planId, 'Custom items']
    );
    const currentCustomItems = currentCustomRows.rows
      .flatMap(row => Array.isArray(row.items) ? row.items : [])
      .filter(item => item && item.is_custom);
    const groceryItemsToSave = currentCustomItems.length
      ? { ...categoryItems, 'Custom items': currentCustomItems }
      : categoryItems;
    await client.query('DELETE FROM grocery_items WHERE plan_id = $1', [planId]);
    for (const [category, items] of Object.entries(groceryItemsToSave)) {
      await client.query(
        'INSERT INTO grocery_items (plan_id, category, items) VALUES ($1, $2, $3)',
        [planId, category, JSON.stringify(items)]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getGroceryList(planId) {
  const result = await pool.query(
    'SELECT category, items FROM grocery_items WHERE plan_id = $1 ORDER BY category',
    [planId]
  );
  return result.rows;
}

async function addCustomGroceryItem(planId, itemName) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const plan = await client.query('SELECT id FROM meal_plans WHERE id = $1 FOR UPDATE', [planId]);
    if (!plan.rows[0]) {
      await client.query('COMMIT');
      return null;
    }

    const category = 'Custom items';
    const item = { name: itemName, is_custom: true, checked: false };
    const existing = await client.query(
      'SELECT id, items FROM grocery_items WHERE plan_id = $1 AND category = $2 ORDER BY id LIMIT 1 FOR UPDATE',
      [planId, category]
    );
    if (existing.rows[0]) {
      await client.query(
        'UPDATE grocery_items SET items = items || $1::jsonb WHERE id = $2',
        [JSON.stringify([item]), existing.rows[0].id]
      );
    } else {
      await client.query(
        'INSERT INTO grocery_items (plan_id, category, items) VALUES ($1, $2, $3)',
        [planId, category, JSON.stringify([item])]
      );
    }

    await client.query('COMMIT');
    return { category, item };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function updateGroceryItemChecked(planId, category, itemName, checked) {
  const result = await pool.query(
    `UPDATE grocery_items AS grocery
     SET items = updated.items
     FROM (
       SELECT gi.id,
              jsonb_agg(
                CASE
                  WHEN entry.item->>'name' = $3
                    THEN jsonb_set(entry.item, '{checked}', to_jsonb($4::boolean), true)
                  ELSE entry.item
                END
                ORDER BY entry.ordinality
              ) AS items
       FROM grocery_items AS gi
       CROSS JOIN LATERAL jsonb_array_elements(gi.items) WITH ORDINALITY AS entry(item, ordinality)
       WHERE gi.plan_id = $1 AND gi.category = $2
       GROUP BY gi.id
     ) AS updated
     WHERE grocery.id = updated.id
       AND EXISTS (
         SELECT 1
         FROM jsonb_array_elements(grocery.items) AS entry(item)
         WHERE entry.item->>'name' = $3
       )
     RETURNING (
       SELECT entry.item
       FROM jsonb_array_elements(grocery.items) AS entry(item)
       WHERE entry.item->>'name' = $3
       LIMIT 1
     ) AS item`,
    [planId, category, itemName, checked]
  );
  return result.rows[0] ? result.rows[0].item : null;
}

async function updateGroceryItemNote(planId, category, itemName, note) {
  const result = await pool.query(
    `UPDATE grocery_items AS grocery
     SET items = updated.items
     FROM (
       SELECT gi.id,
              jsonb_agg(
                CASE
                  WHEN entry.item->>'name' = $3
                    THEN jsonb_set(entry.item, '{note}', to_jsonb($4::text), true)
                  ELSE entry.item
                END
                ORDER BY entry.ordinality
              ) AS items
       FROM grocery_items AS gi
       CROSS JOIN LATERAL jsonb_array_elements(gi.items) WITH ORDINALITY AS entry(item, ordinality)
       WHERE gi.plan_id = $1 AND gi.category = $2
       GROUP BY gi.id
     ) AS updated
     WHERE grocery.id = updated.id
       AND EXISTS (
         SELECT 1
         FROM jsonb_array_elements(grocery.items) AS entry(item)
         WHERE entry.item->>'name' = $3
       )
     RETURNING (
       SELECT entry.item
       FROM jsonb_array_elements(grocery.items) AS entry(item)
       WHERE entry.item->>'name' = $3
       LIMIT 1
     ) AS item`,
    [planId, category, itemName, note]
  );
  return result.rows[0] ? result.rows[0].item : null;
}

async function resetGroceryProgress(planId) {
  const result = await pool.query(
    `UPDATE grocery_items AS grocery
     SET items = COALESCE(
       (
         SELECT jsonb_agg(
           jsonb_set(entry.item, '{checked}', 'false'::jsonb, true)
           ORDER BY entry.ordinality
         )
         FROM jsonb_array_elements(grocery.items) WITH ORDINALITY AS entry(item, ordinality)
       ),
       '[]'::jsonb
     )
     WHERE grocery.plan_id = $1
     RETURNING category, items`,
    [planId]
  );
  return result.rows;
}

// Add a recipe to the next available day slot in a plan.
// Returns the updated seven-day array and assigned slot without committing it.
async function addRecipeToDay(planId, recipeId, recipe) {
  const plan = await getMealPlan(planId);
  if (!plan) return null;

  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const days = plan.days || [];
  const totalDays = Math.max(days.length, 7);

  // Find first empty or "leftover" slot, else overwrite Monday
  let targetIndex = days.findIndex(d => !d.recipe_id || d.meal?.toLowerCase().includes('leftover'));
  if (targetIndex === -1) targetIndex = 0;

  const newDay = {
    day: DAYS[targetIndex],
    recipe_id: recipeId,
    meal: recipe.name,
    base_servings: Number(recipe.base_servings) > 0 ? Number(recipe.base_servings) : 4,
    description: recipe.description || '',
    prep_time: recipe.prep_time_minutes || 0,
    protein_type: recipe.protein_type || null,
    ingredients: recipe.ingredients || [],
    instructions: recipe.instructions || [],
    tags: recipe.tags || []
  };

  // Per-day pricing: fetch pantry and CSA items for the plan owner so covered
  // ingredients don't contribute. Anonymous plans (user_id IS NULL) get empty
  // arrays — keeps the existing behavior of just showing best-store totals.
  const pantryItems = plan.user_id ? await pantryDb.getPantryItems(plan.user_id) : [];
  const csaItems = plan.user_id ? await pantryDb.getCsaItems(plan.user_id) : [];
  newDay.pricing = await computeDayPricing({ ...recipe, base_servings: newDay.base_servings, ingredients: newDay.ingredients }, pricesDb, pantryItems, csaItems, plan.servings || 2);

  // Build updated days array to always have 7 entries
  const updatedDays = [];
  for (let i = 0; i < 7; i++) {
    if (i === targetIndex) {
      updatedDays.push(newDay);
    } else if (days[i]) {
      updatedDays.push(days[i]);
    } else {
      updatedDays.push({ day: DAYS[i], recipe_id: null, meal: '', description: '', prep_time: 0, protein_type: null, ingredients: [], tags: [] });
    }
  }

  // Stamp `pricing` on any empty-stub day that lacks one so the persisted
  // shape matches every other writer (and the frontend gate `d.pricing && d.pricing.has_pricing`).
  // Existing days with a recipe keep their stored pricing untouched.
  for (const d of updatedDays) {
    if (d && d.recipe_id == null && !d.pricing) {
      d.pricing = await computeDayPricing({ ingredients: [] }, pricesDb, pantryItems, csaItems);
    }
  }

  return { planId, day: DAYS[targetIndex], dayIndex: targetIndex, days: updatedDays };
}

// Get the most recent plan for a user (null userId = anonymous)
async function getLatestPlan(userId = null) {
  const result = await pool.query(
    'SELECT * FROM meal_plans WHERE user_id IS NOT DISTINCT FROM $1 ORDER BY created_at DESC LIMIT 1',
    [userId]
  );
  return result.rows[0] || null;
}

async function listMealPlanSnapshots(userId) {
  const result = await pool.query(
    `SELECT mp.id,
            mp.user_id,
            mp.plan_name,
            mp.days,
            mp.weekly_budget_target,
            mp.servings,
            mp.created_at,
            COALESCE(
              jsonb_object_agg(gi.category, gi.items) FILTER (WHERE gi.id IS NOT NULL),
              '{}'::jsonb
            ) AS grocery_list
       FROM meal_plans AS mp
       LEFT JOIN grocery_items AS gi ON gi.plan_id = mp.id
      WHERE mp.user_id = $1
      GROUP BY mp.id
      ORDER BY mp.created_at DESC`,
    [userId]
  );
  return result.rows;
}

module.exports = {
  createMealPlan,
  saveMealPlanSnapshot,
  getMealPlan,
  getMealPlanForUser,
  saveGroceryList,
  saveMealPlanAndGroceryList,
  getGroceryList,
  addCustomGroceryItem,
  updateGroceryItemChecked,
  updateGroceryItemNote,
  resetGroceryProgress,
  addRecipeToDay,
  getLatestPlan,
  listMealPlanSnapshots
};
