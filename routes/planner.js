// Planner routes: meal plan generation + grocery list retrieval.
const express = require('express');
const router = express.Router();
const recipesDb = require('../db/recipes');
const plansDb = require('../db/meal-plans');
const bookmarksDb = require('../db/user-bookmarks');
const pantryDb = require('../db/pantry-items');
const pricesDb = require('../db/prices');
const { generateMealPlan, buildGroceryList, computeDayPricing, isGroceryListComplete } = require('../services/meal-planner');
const { rejectMismatchedUserId, requireAuth } = require('../lib/require-auth');

router.use(requireAuth, rejectMismatchedUserId);

function parsePlannerDayIndex(value) {
  if ((typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && value.trim() === '')) {
    return null;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed < 7 ? parsed : null;
}

function normalizePlannerIngredientName(name) {
  return String(name || '').toLowerCase().trim().replace(/\b(maybe|optional|small|medium|large)\b/g, '').trim();
}

function preserveGroceryItemState(groceryList, previousRows) {
  const priorItemsByName = new Map();
  const customItems = [];
  for (const row of previousRows || []) {
    for (const item of row.items || []) {
      if (row.category === 'Custom items') {
        if (item && item.is_custom) customItems.push({ ...item });
        continue;
      }
      if (item && item.is_custom) continue;
      const key = normalizePlannerIngredientName(item && item.name);
      if (key && !priorItemsByName.has(key)) priorItemsByName.set(key, item);
    }
  }
  if (customItems.length) groceryList['Custom items'] = customItems;
  for (const items of Object.values(groceryList || {})) {
    for (const item of items) {
      if (item && item.is_custom) continue;
      const previous = priorItemsByName.get(normalizePlannerIngredientName(item.name));
      if (!previous) continue;
      if (Object.prototype.hasOwnProperty.call(previous, 'checked')) item.checked = previous.checked;
      if (Object.prototype.hasOwnProperty.call(previous, 'note')) item.note = previous.note;
    }
  }
}

async function rebuildPlanShoppingData(plan, pantryItems, csaItems, previousRows) {
  const servings = plan.servings || 2;
  const days = await Promise.all((plan.days || []).map(async day => {
    if (!day || day.recipe_id == null) return day;
    const base_servings = day.base_servings || 4;
    const pricing = await computeDayPricing({ ingredients: day.ingredients || [], base_servings }, pricesDb, pantryItems, csaItems, servings);
    return { ...day, base_servings, pricing };
  }));
  const groceryList = await buildGroceryList(
    days.filter(day => day && day.recipe_id != null)
      .map(day => ({ name: day.meal, base_servings: day.base_servings || 4, ingredients: day.ingredients || [] })),
    pricesDb,
    pantryItems,
    csaItems,
    servings
  );
  preserveGroceryItemState(groceryList, previousRows);
  await plansDb.saveMealPlanAndGroceryList(plan.id, days, groceryList);
  return { days, grocery_list: groceryList };
}

function parseWeeklyBudgetTarget(value) {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    return { valid: true, value: null };
  }
  if (typeof value !== 'number' && typeof value !== 'string') {
    return { valid: true, value: null };
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { valid: true, value: null };
  }
  const rounded = Math.round((parsed + Number.EPSILON) * 100) / 100;
  return { valid: true, value: rounded <= 99999999.99 ? rounded : null };
}

function parseDinnersNeeded(value) {
  if (value === undefined) {
    return { valid: true, value: 7 };
  }
  if (typeof value !== 'number' && typeof value !== 'string') {
    return { valid: false, value: null };
  }
  if (typeof value === 'string' && value.trim() === '') {
    return { valid: false, value: null };
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 7
    ? { valid: true, value: parsed }
    : { valid: false, value: null };
}

function parseServings(value) {
  if (value === undefined) return { valid: true, value: 2 };
  if ((typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && value.trim() === '')) {
    return { valid: false, value: null };
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 12
    ? { valid: true, value: parsed }
    : { valid: false, value: null };
}

// POST /api/planner/generate
// Body: { dinnersNeeded?, servings?, mustHaveRecipes?, mustHaveRecipeIds?, mustHaveIngredients?, avoidIngredients?, excludeDietary?, preferSourcingStandard?, weeklyBudgetTarget? }
router.post('/generate', async (req, res) => {
  try {
    const {
      dinnersNeeded,
      servings,
      mustHaveRecipes = [],
      mustHaveRecipeIds = [],
      mustHaveIngredients = [],
      avoidIngredients = [],
      excludeDietary = [],
      preferSourcingStandard = true,
      weeklyBudgetTarget = null
    } = req.body || {};
    const resolvedUserId = req.authenticatedUserId;
    const parsedDinners = parseDinnersNeeded(dinnersNeeded);
    if (!parsedDinners.valid) {
      return res.status(400).json({ error: 'dinnersNeeded must be a whole number from 1 through 7' });
    }
    const parsedServings = parseServings(servings);
    if (!parsedServings.valid) {
      return res.status(400).json({ error: 'servings must be a whole number from 1 through 12' });
    }
    const parsedBudget = parseWeeklyBudgetTarget(weeklyBudgetTarget);

    // Fetch bookmarked recipe IDs for weighting, pantry items for grocery filtering,
    // and CSA box items so covered produce doesn't hit the buy list.
    let bookmarkedRecipeIds = [];
    let pantryItems = [];
    let csaItems = [];
    if (resolvedUserId) {
      [bookmarkedRecipeIds, pantryItems, csaItems] = await Promise.all([
        bookmarksDb.getBookmarkedRecipeIds(resolvedUserId),
        pantryDb.getPantryItems(resolvedUserId),
        pantryDb.getCsaItems(resolvedUserId)
      ]);
    }

    const plan = await generateMealPlan({
      dinnersNeeded: parsedDinners.value,
      servings: parsedServings.value,
      mustHaveRecipes,
      mustHaveRecipeIds,
      mustHaveIngredients,
      avoidIngredients,
      excludeDietary,
      preferSourcingStandard,
      bookmarkedRecipeIds,
      pantryItems,
      csaItems
    }, recipesDb, pricesDb);

    const savedSnapshot = await plansDb.saveMealPlanSnapshot(
      resolvedUserId,
      plan.days,
      parsedServings.value,
      parsedBudget.value,
      plan.grocery_list
    );
    const savedPlan = savedSnapshot.plan;

    res.json({
      plan_id: savedPlan.id,
      days: plan.days,
      grocery_list: savedSnapshot.grocery_list,
      servings: savedPlan.servings,
      weekly_budget_target: savedPlan.weekly_budget_target,
      created_at: savedPlan.created_at,
      stats: plan.stats,
      bookmarked_recipe_ids: bookmarkedRecipeIds,
      pantry_items_count: pantryItems.length,
      csa_items_count: csaItems.length
    });
  } catch (err) {
    console.error('[/api/planner/generate]', err);
    const status = err.code === 'UNSATISFIED_REQUIRED_INGREDIENT' ? 422 : 500;
    res.status(status).json({ error: err.message || 'Failed to generate meal plan', code: err.code || null });
  }
});

// POST /api/planner/plan/:id/save
// Body: { days: [], grocery_list: {} }
router.post('/plan/:id/save', async (req, res) => {
  const userId = req.authenticatedUserId;

  const planId = Number(req.params.id);
  const body = req.body || {};
  if (!Number.isSafeInteger(planId) || planId <= 0) {
    return res.status(400).json({ error: 'Invalid plan id' });
  }
  if (!Array.isArray(body.days) || !body.grocery_list || typeof body.grocery_list !== 'object' || Array.isArray(body.grocery_list)) {
    return res.status(400).json({ error: 'days must be an array and grocery_list must be an object' });
  }

  try {
    const plan = await plansDb.getMealPlan(planId);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    if (plan.user_id !== userId) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    await plansDb.saveMealPlanAndGroceryList(planId, body.days, body.grocery_list);
    return res.json({ saved: true, plan_id: planId });
  } catch (err) {
    console.error('[/api/planner/plan/:id/save]', err);
    return res.status(500).json({ error: 'Failed to save meal plan' });
  }
});

// GET /api/planner/latest
router.get('/latest', async (req, res) => {
  const userId = req.authenticatedUserId;
  try {
    const plan = await plansDb.getLatestPlan(userId);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    const groceryRows = await plansDb.getGroceryList(plan.id);
    let bookmarkedRecipeIds = [];
    let pantryItems = [];
    let csaItems = [];
    if (userId) {
      [bookmarkedRecipeIds, pantryItems, csaItems] = await Promise.all([
        bookmarksDb.getBookmarkedRecipeIds(userId),
        pantryDb.getPantryItems(userId),
        pantryDb.getCsaItems(userId)
      ]);
    }

    let days = plan.days || [];
    let groceryList = Object.fromEntries(groceryRows.map(row => [row.category, row.items || []]));
    const staleItems = groceryRows.some(row => (row.items || []).some(item =>
      !item || (!item.is_custom && !Object.prototype.hasOwnProperty.call(item, 'price_status'))));
    const stalePricing = days.some(day => day && day.recipe_id != null &&
      (!day.base_servings || !day.pricing || !Object.prototype.hasOwnProperty.call(day.pricing, 'unpriced_count')));
    const incompleteIngredients = !isGroceryListComplete(groceryRows, days);
    if (staleItems || stalePricing || incompleteIngredients) {
      const rebuilt = await rebuildPlanShoppingData(plan, pantryItems, csaItems, groceryRows);
      days = rebuilt.days;
      groceryList = rebuilt.grocery_list;
    }

    res.json({
      plan_id: plan.id,
      days,
      grocery_list: groceryList,
      servings: plan.servings || 2,
      weekly_budget_target: plan.weekly_budget_target,
      created_at: plan.created_at,
      bookmarked_recipe_ids: bookmarkedRecipeIds,
      pantry_items_count: pantryItems.length,
      csa_items_count: csaItems.length
    });
  } catch (err) {
    console.error('[/api/planner/latest]', err);
    res.status(500).json({ error: 'Failed to fetch latest meal plan' });
  }
});

// GET /api/planner/plans
router.get('/plans', async (req, res) => {
  const userId = req.authenticatedUserId;

  try {
    const plans = await plansDb.listMealPlanSnapshots(userId);
    res.json({ plans });
  } catch (err) {
    console.error('[/api/planner/plans]', err);
    res.status(500).json({ error: 'Failed to fetch meal plans' });
  }
});

// GET /api/planner/plan/:id
router.get('/plan/:id', async (req, res) => {
  const userId = req.authenticatedUserId;

  const planId = Number(req.params.id);
  if (!Number.isSafeInteger(planId) || planId <= 0) {
    return res.status(400).json({ error: 'Invalid plan id' });
  }

  try {
    const plan = await plansDb.getMealPlanForUser(planId, userId);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    const groceries = await plansDb.getGroceryList(planId);
    res.json({ plan, groceries });
  } catch (err) {
    console.error('[/api/planner/plan/:id]', err);
    res.status(500).json({ error: 'Failed to fetch plan' });
  }
});

// GET /api/planner/plan/:id/swap-options?dayIndex=0&userId=...
router.get('/plan/:id/swap-options', async (req, res) => {
  const userId = req.authenticatedUserId;
  const planId = Number(req.params.id);
  const dayIndex = parsePlannerDayIndex(req.query.dayIndex);

  if (!Number.isInteger(planId) || planId <= 0) {
    return res.status(400).json({ error: 'Invalid plan id' });
  }
  if (dayIndex === null) {
    return res.status(400).json({ error: 'dayIndex must be a whole number from 0 through 6' });
  }

  try {
    const plan = await plansDb.getMealPlan(planId);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    if (plan.user_id !== userId) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    const days = Array.isArray(plan.days) ? plan.days : [];
    if (!days[dayIndex] || days[dayIndex].recipe_id == null) {
      return res.status(400).json({ error: 'The selected day does not have a recipe to swap' });
    }

    const assignedRecipeIds = new Set(days
      .filter(day => day && day.recipe_id != null)
      .map(day => Number(day.recipe_id)));
    const recipes = await recipesDb.getAllRecipes();
    const options = recipes
      .filter(recipe => !assignedRecipeIds.has(Number(recipe.id)))
      .map(recipe => ({
        id: recipe.id,
        name: recipe.name,
        description: recipe.description || '',
        prep_time_minutes: recipe.prep_time_minutes || 0,
        cook_time_minutes: recipe.cook_time_minutes || 0,
        protein_type: recipe.protein_type || null,
        dietary_flags: recipe.dietary_flags || [],
        sourcing_standard: !!recipe.sourcing_standard
      }));

    return res.json({ dayIndex, options });
  } catch (err) {
    console.error('[/api/planner/plan/:id/swap-options]', err);
    return res.status(500).json({ error: 'Failed to load recipe options' });
  }
});

// POST /api/planner/plan/:id/swap-recipe
// Body: { dayIndex: number, recipeId: number, userId: number|null }
router.post('/plan/:id/swap-recipe', async (req, res) => {
  const userId = req.authenticatedUserId;
  const planId = Number(req.params.id);
  const body = req.body || {};
  const dayIndex = parsePlannerDayIndex(body.dayIndex);
  const recipeId = Number(body.recipeId);

  if (!Number.isInteger(planId) || planId <= 0) {
    return res.status(400).json({ error: 'Invalid plan id' });
  }
  if (dayIndex === null) {
    return res.status(400).json({ error: 'dayIndex must be a whole number from 0 through 6' });
  }
  if (!Number.isInteger(recipeId) || recipeId <= 0) {
    return res.status(400).json({ error: 'A valid recipeId is required' });
  }

  try {
    const plan = await plansDb.getMealPlan(planId);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    if (plan.user_id !== userId) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    const days = Array.isArray(plan.days) ? plan.days : [];
    if (!days[dayIndex] || days[dayIndex].recipe_id == null) {
      return res.status(400).json({ error: 'The selected day does not have a recipe to swap' });
    }
    if (days.some(day => day && Number(day.recipe_id) === recipeId)) {
      return res.status(400).json({ error: 'That recipe is already in this plan' });
    }

    const recipe = await recipesDb.getRecipeById(recipeId);
    if (!recipe) return res.status(400).json({ error: 'Recipe not found' });

    const pantryItems = plan.user_id ? await pantryDb.getPantryItems(plan.user_id) : [];
    const csaItems = plan.user_id ? await pantryDb.getCsaItems(plan.user_id) : [];
    const newDay = {
      ...days[dayIndex],
      recipe_id: recipe.id,
      meal: recipe.name,
      base_servings: Number(recipe.base_servings) > 0 ? Number(recipe.base_servings) : 4,
      description: recipe.description || '',
      prep_time: recipe.prep_time_minutes || 0,
      protein_type: recipe.protein_type || null,
      ingredients: Array.isArray(recipe.ingredients) ? recipe.ingredients : [],
      instructions: Array.isArray(recipe.instructions) ? recipe.instructions : [],
      tags: Array.isArray(recipe.tags) ? recipe.tags : []
    };
    newDay.pricing = await computeDayPricing({ ingredients: newDay.ingredients, base_servings: newDay.base_servings }, pricesDb, pantryItems, csaItems, plan.servings || 2);

    const updatedDays = days.map((day, index) => index === dayIndex ? newDay : day);
    const groceryList = await buildGroceryList(
      updatedDays
        .filter(day => day && day.recipe_id != null)
        .map(day => ({ name: day.meal, base_servings: day.base_servings || 4, ingredients: Array.isArray(day.ingredients) ? day.ingredients : [] })),
      pricesDb,
      pantryItems,
      csaItems,
      plan.servings || 2
    );

    const previousRows = await plansDb.getGroceryList(planId);
    preserveGroceryItemState(groceryList, previousRows);

    await plansDb.saveMealPlanAndGroceryList(planId, updatedDays, groceryList);
    return res.json({
      plan_id: plan.id,
      days: updatedDays,
      grocery_list: groceryList,
      servings: plan.servings || 2,
      weekly_budget_target: plan.weekly_budget_target,
      created_at: plan.created_at
    });
  } catch (err) {
    console.error('[/api/planner/plan/:id/swap-recipe]', err);
    return res.status(500).json({ error: 'Failed to swap recipe' });
  }
});

// POST /api/planner/plan/:id/custom-item
// Body: { itemName: string, userId: number|null }
router.post('/plan/:id/custom-item', async (req, res) => {
  const userId = req.authenticatedUserId;
  const planId = Number(req.params.id);
  const body = req.body || {};
  const itemName = typeof body.itemName === 'string' ? body.itemName.trim() : '';

  if (!Number.isInteger(planId) || planId <= 0) {
    return res.status(400).json({ error: 'Invalid plan id' });
  }
  if (!itemName || itemName.length > 255) {
    return res.status(400).json({ error: 'A valid itemName is required' });
  }
  try {
    const plan = await plansDb.getMealPlan(planId);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    if (plan.user_id !== userId) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    const saved = await plansDb.addCustomGroceryItem(planId, itemName);
    if (!saved) return res.status(404).json({ error: 'Plan not found' });
    return res.json(saved);
  } catch (err) {
    console.error('[/api/planner/plan/:id/custom-item]', err);
    return res.status(500).json({ error: 'Failed to add custom grocery item' });
  }
});

// PATCH /api/planner/plan/:id/grocery-item
// Body: { category: string, itemName: string, checked: boolean, userId: number|null }
router.patch('/plan/:id/grocery-item', async (req, res) => {
  const userId = req.authenticatedUserId;
  const planId = Number(req.params.id);
  const body = req.body || {};
  const category = typeof body.category === 'string' ? body.category.trim() : '';
  const itemName = typeof body.itemName === 'string' ? body.itemName.trim() : '';

  if (!Number.isInteger(planId) || planId <= 0) {
    return res.status(400).json({ error: 'Invalid plan id' });
  }
  if (!category || category.length > 100) {
    return res.status(400).json({ error: 'A valid category is required' });
  }
  if (!itemName || itemName.length > 255) {
    return res.status(400).json({ error: 'A valid itemName is required' });
  }
  if (typeof body.checked !== 'boolean') {
    return res.status(400).json({ error: 'checked must be a boolean' });
  }
  try {
    const plan = await plansDb.getMealPlan(planId);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    if (plan.user_id !== userId) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    const item = await plansDb.updateGroceryItemChecked(planId, category, itemName, body.checked);
    if (!item) return res.status(404).json({ error: 'Grocery item not found' });

    return res.json({ item });
  } catch (err) {
    console.error('[/api/planner/plan/:id/grocery-item]', err);
    return res.status(500).json({ error: 'Failed to update grocery item' });
  }
});

// PATCH /api/planner/plan/:id/grocery-item/note
// Body: { category: string, itemName: string, note: string, userId: number|null }
router.patch('/plan/:id/grocery-item/note', async (req, res) => {
  const userId = req.authenticatedUserId;
  const planId = Number(req.params.id);
  const body = req.body || {};
  const category = typeof body.category === 'string' ? body.category.trim() : '';
  const itemName = typeof body.itemName === 'string' ? body.itemName.trim() : '';
  const note = typeof body.note === 'string' ? body.note.trim() : null;

  if (!Number.isInteger(planId) || planId <= 0) {
    return res.status(400).json({ error: 'Invalid plan id' });
  }
  if (!category || category.length > 100) {
    return res.status(400).json({ error: 'A valid category is required' });
  }
  if (!itemName || itemName.length > 255) {
    return res.status(400).json({ error: 'A valid itemName is required' });
  }
  if (note === null || note.length > 500) {
    return res.status(400).json({ error: 'note must be a string no longer than 500 characters' });
  }
  try {
    const plan = await plansDb.getMealPlan(planId);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    if (plan.user_id !== userId) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    const item = await plansDb.updateGroceryItemNote(planId, category, itemName, note);
    if (!item) return res.status(404).json({ error: 'Grocery item not found' });

    return res.json({ item });
  } catch (err) {
    console.error('[/api/planner/plan/:id/grocery-item/note]', err);
    return res.status(500).json({ error: 'Failed to update grocery item note' });
  }
});

// POST /api/planner/plan/:id/reset-grocery-progress
// Body: { userId: number|null }
router.post('/plan/:id/reset-grocery-progress', async (req, res) => {
  const userId = req.authenticatedUserId;
  const planId = Number(req.params.id);

  if (!Number.isInteger(planId) || planId <= 0) {
    return res.status(400).json({ error: 'Invalid plan id' });
  }
  try {
    const plan = await plansDb.getMealPlan(planId);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    if (plan.user_id !== userId) {
      return res.status(403).json({ error: 'You do not have access to this plan' });
    }

    const groceryRows = await plansDb.resetGroceryProgress(planId);
    return res.json({
      grocery_list: Object.fromEntries(groceryRows.map(row => [row.category, row.items || []]))
    });
  } catch (err) {
    console.error('[/api/planner/plan/:id/reset-grocery-progress]', err);
    return res.status(500).json({ error: 'Failed to reset grocery progress' });
  }
});

// GET /api/planner/plan/:id/export?format=csv|txt
router.get('/plan/:id/export', async (req, res) => {
  const userId = req.authenticatedUserId;

  try {
    const { format = 'csv' } = req.query;
    if (format !== 'csv' && format !== 'txt') {
      return res.status(400).json({ error: 'format must be "csv" or "txt"' });
    }

    const planId = Number(req.params.id);
    if (!Number.isSafeInteger(planId) || planId <= 0) {
      return res.status(400).json({ error: 'Invalid plan id' });
    }

    const plan = await plansDb.getMealPlanForUser(planId, userId);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    const rows = await plansDb.getGroceryList(planId);
    const byCategory = Object.fromEntries(rows.map(r => [r.category, r.items || []]));

    if (format === 'csv') {
      const escape = (val) => {
        const s = String(val ?? '');
        return `"${s.replace(/"/g, '""')}"`;
      };
      const lines = ['Category,Item,Quantity,Recipes,Note'];
      for (const [category, items] of Object.entries(byCategory)) {
        for (const item of items) {
          const recipes = Array.isArray(item.from_recipes) ? item.from_recipes.join('; ') : '';
          lines.push([
            escape(category),
            escape(item.name),
            escape(item.quantity),
            escape(recipes),
            escape(item.note)
          ].join(','));
        }
      }
      const csv = lines.join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="pantry-grocery-list-${planId}.csv"`);
      return res.send(csv);
    }

    // TXT
    const lines = ['PANTRY — GROCERY LIST', `Plan #${planId}`, '='.repeat(24)];
    for (const [category, items] of Object.entries(byCategory)) {
      lines.push('', category.toUpperCase(), '-'.repeat(category.length));
      for (const item of items) {
        const qty = item.quantity ? ` (${item.quantity})` : '';
        const recipes = Array.isArray(item.from_recipes) && item.from_recipes.length
          ? ` — for: ${item.from_recipes.join(', ')}`
          : '';
        const note = typeof item.note === 'string' && item.note.trim() ? ` — note: ${item.note.trim()}` : '';
        lines.push(`${item.name}${qty}${recipes}${note}`);
      }
    }
    const text = lines.join('\n') + '\n';
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="pantry-grocery-list-${planId}.txt"`);
    return res.send(text);
  } catch (err) {
    console.error('[/api/planner/plan/:id/export]', err);
    res.status(500).json({ error: 'Failed to export grocery list' });
  }
});


module.exports = router;
