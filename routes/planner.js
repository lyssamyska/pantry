// Planner routes: meal plan generation + grocery list retrieval.
const express = require('express');
const router = express.Router();
const recipesDb = require('../db/recipes');
const plansDb = require('../db/meal-plans');
const bookmarksDb = require('../db/user-bookmarks');
const pantryDb = require('../db/pantry-items');
const pricesDb = require('../db/prices');
const { generateMealPlan, buildGroceryList, computeDayPricing, isGroceryListComplete } = require('../services/meal-planner');
const { reportError } = require('../lib/polsia-log');
const { rejectMismatchedUserId, requirePaidAccess } = require('../lib/pantry-access');

router.use((req, res, next) => {
  if (req.method === 'POST' && req.path === '/seed-recipes') return next();
  return requirePaidAccess(req, res, () => rejectMismatchedUserId(req, res, next));
});

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
    reportError(Object.assign(err, { userId: req.authenticatedUserId }), '/api/planner/generate');
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
    reportError(Object.assign(err, { userId }), `/api/planner/plan/${planId}/save`);
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
    reportError(Object.assign(err, { userId }), '/api/planner/latest');
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
    reportError(Object.assign(err, { userId }), '/api/planner/plans');
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
    reportError(Object.assign(err, { userId }), `/api/planner/plan/${planId}`);
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
    reportError(Object.assign(err, { userId }), `/api/planner/plan/${planId}/swap-options`);
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
    reportError(Object.assign(err, { userId }), `/api/planner/plan/${planId}/swap-recipe`);
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
    reportError(Object.assign(err, { userId }), `/api/planner/plan/${planId}/custom-item`);
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
    reportError(Object.assign(err, { userId }), `/api/planner/plan/${planId}/grocery-item`);
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
    reportError(Object.assign(err, { userId }), `/api/planner/plan/${planId}/grocery-item/note`);
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
    reportError(Object.assign(err, { userId }), `/api/planner/plan/${planId}/reset-grocery-progress`);
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
    reportError(Object.assign(err, { userId }), `/api/planner/plan/${req.params.id}/export`);
    console.error('[/api/planner/plan/:id/export]', err);
    res.status(500).json({ error: 'Failed to export grocery list' });
  }
});

// POST /api/planner/seed-recipes — idempotent seeding of 51 recipes
router.post('/seed-recipes', async (req, res) => {
  try {
    const count = await recipesDb.countRecipes();
    if (count >= 51) {
      return res.json({ message: 'Already seeded', count });
    }

    const { seedRecipes } = recipesDb;
    const recipes = getSeedRecipes();
    await seedRecipes(recipes);

    res.json({ message: 'Seeded', count: recipes.length });
  } catch (err) {
    reportError(err, '/api/planner/seed-recipes');
    console.error('[/api/planner/seed-recipes]', err);
    res.status(500).json({ error: 'Failed to seed recipes' });
  }
});

function getSeedRecipes() {
  return [
    // ── Beef ──
    { name: 'Sweet Potato Meatballs', description: 'Tender ground turkey meatballs with roasted sweet potato, herbs, and garlic', prep_time_minutes: 20, cook_time_minutes: 25, protein_type: 'turkey', dietary_flags: ['gluten-free', 'dairy-free'], sourcing_standard: true, ingredients: [{name: 'sweet potato meatballs', quantity: '4'}, {name: 'ground turkey', quantity: '1 lb', sourcing_hint: 'pastured'}, {name: 'sweet potato', quantity: '1 medium'}, {name: 'egg', quantity: '1'}, {name: 'garlic', quantity: '2 cloves'}, {name: 'parsley', quantity: '2 tbsp'}, {name: 'olive oil', quantity: '1 tbsp'}], instructions: ['Roast sweet potato until tender and mash', 'Mix sweet potato with turkey, egg, garlic, and parsley', 'Shape into meatballs and sear in olive oil', 'Bake at 400°F until cooked through, about 15 minutes'], tags: ['dinner', 'healthy', 'meal-prep'] },
    { name: 'Herb-Crusted Beef Tenderloin', description: 'Seared tenderloin with rosemary-thyme crust, served with roasted shallot jus', prep_time_minutes: 25, cook_time_minutes: 20, protein_type: 'beef', dietary_flags: ['gluten-free'], sourcing_standard: true, ingredients: [{name: 'beef tenderloin', quantity: '1.5 lbs', sourcing_hint: 'grass-fed'}, {name: 'fresh rosemary', quantity: '2 tbsp'}, {name: 'fresh thyme', quantity: '1 tbsp'}, {name: 'garlic', quantity: '4 cloves'}, {name: 'olive oil', quantity: '2 tbsp'}, {name: 'butter', quantity: '2 tbsp'}, {name: 'shallots', quantity: '3'}, {name: 'beef broth', quantity: '0.5 cup'}], instructions: ['Preheat oven to 425°F', 'Season beef with salt, pepper, herbs, minced garlic', 'Sear in hot skillet with olive oil 2 min per side', 'Roast 12-15 min until internal temp 130°F', 'Rest 5 min, slice, serve with pan jus'], tags: ['dinner', 'elegant'] },
    { name: 'Braised Beef Short Ribs', description: 'Slow-braised short ribs in red wine and vegetable stock, served over egg noodles', prep_time_minutes: 30, cook_time_minutes: 180, protein_type: 'beef', dietary_flags: [], sourcing_standard: true, ingredients: [{name: 'beef short ribs', quantity: '3 lbs', sourcing_hint: 'grass-fed'}, {name: 'red wine', quantity: '1 cup'}, {name: 'beef broth', quantity: '2 cups'}, {name: 'carrots', quantity: '3'}, {name: 'celery', quantity: '2 stalks'}, {name: 'onion', quantity: '1 large'}, {name: 'garlic', quantity: '4 cloves'}, {name: 'tomato paste', quantity: '2 tbsp'}, {name: 'egg noodles', quantity: '12 oz'}], instructions: ['Season and sear ribs on all sides', 'Sauté onion, carrot, celery until softened', 'Add tomato paste, deglaze with wine', 'Add broth, cover, braise 3 hours at 325°F', 'Serve over egg noodles'], tags: ['dinner', 'comfort'] },
    { name: 'Grass-Fed Beef Tacos', description: 'Seasoned grass-fed beef in corn tortillas with fresh pico de gallo and avocado', prep_time_minutes: 20, cook_time_minutes: 15, protein_type: 'beef', dietary_flags: ['gluten-free', 'dairy-free'], sourcing_standard: true, ingredients: [{name: 'ground beef', quantity: '1 lb', sourcing_hint: 'grass-fed'}, {name: 'corn tortillas', quantity: '8'}, {name: 'onion', quantity: '0.5'}, {name: 'tomato', quantity: '2'}, {name: 'cilantro', quantity: '0.5 cup'}, {name: 'lime', quantity: '2'}, {name: 'avocado', quantity: '1'}, {name: 'chili powder', quantity: '1 tbsp'}, {name: 'cumin', quantity: '1 tsp'}, {name: 'garlic', quantity: '2 cloves'}], instructions: ['Cook beef with chili powder, cumin, garlic', 'Dice tomato and onion, mix with cilantro and lime juice', 'Warm tortillas', 'Assemble tacos with beef, pico, and avocado slices'], tags: ['dinner', 'quick', 'mexican'] },
    { name: 'Steak au Poivre', description: 'Pan-seared tri-tip with cracked peppercorn cream sauce, served with roasted potatoes', prep_time_minutes: 15, cook_time_minutes: 20, protein_type: 'beef', dietary_flags: ['gluten-free'], sourcing_standard: true, ingredients: [{name: 'tri-tip steak', quantity: '1.5 lbs', sourcing_hint: 'grass-fed'}, {name: 'black pepper', quantity: '2 tbsp'}, {name: 'heavy cream', quantity: '0.5 cup'}, {name: 'brandy', quantity: '0.25 cup'}, {name: 'butter', quantity: '3 tbsp'}, {name: 'shallots', quantity: '2'}, {name: 'potato', quantity: '1.5 lbs'}, {name: 'olive oil', quantity: '2 tbsp'}], instructions: ['Coat steak generously with cracked pepper', 'Sear in hot cast iron 3-4 min per side', 'Rest while making sauce: sauté shallots, add brandy, cream, reduce', 'Roast cubed potatoes at 425°F 25 min', 'Slice steak against grain, serve with sauce and potatoes'], tags: ['dinner', 'french', 'elegant'] },
    { name: 'Korean BBQ Beef Bowl', description: 'Marinated grass-fed beef over rice with pickled vegetables and gochujang sauce', prep_time_minutes: 20, cook_time_minutes: 15, protein_type: 'beef', dietary_flags: ['dairy-free'], sourcing_standard: true, ingredients: [{name: 'beef sirloin', quantity: '1 lb', sourcing_hint: 'grass-fed'}, {name: 'soy sauce', quantity: '0.25 cup'}, {name: 'sesame oil', quantity: '2 tbsp'}, {name: 'brown sugar', quantity: '1 tbsp'}, {name: 'garlic', quantity: '3 cloves'}, {name: 'ginger', quantity: '1 tbsp'}, {name: 'rice', quantity: '2 cups'}, {name: 'cucumber', quantity: '1'}, {name: 'carrot', quantity: '1'}, {name: 'scallion', quantity: '2'}, {name: 'sesame seeds', quantity: '1 tbsp'}], instructions: ['Slice beef thin, marinate in soy sauce, sesame oil, sugar, garlic, ginger 20 min', 'Cook rice', 'Slice cucumber and carrot thin, toss with rice vinegar', 'Sear beef in hot pan 1-2 min per side', 'Assemble bowls with rice, beef, pickled veg, sesame seeds'], tags: ['dinner', 'korean'] },
    { name: 'Beef Bourguignon', description: 'Classic French stew with grass-fed beef, pearl onions, and mushrooms in red wine', prep_time_minutes: 30, cook_time_minutes: 150, protein_type: 'beef', dietary_flags: [], sourcing_standard: true, ingredients: [{name: 'beef chuck', quantity: '2 lbs', sourcing_hint: 'grass-fed'}, {name: 'bacon', quantity: '4 oz'}, {name: 'pearl onions', quantity: '1 cup'}, {name: 'cremini mushrooms', quantity: '8 oz'}, {name: 'carrot', quantity: '2'}, {name: 'red wine', quantity: '2 cups'}, {name: 'beef broth', quantity: '1 cup'}, {name: 'tomato paste', quantity: '1 tbsp'}, {name: 'garlic', quantity: '3 cloves'}, {name: 'thyme', quantity: '4 sprigs'}, {name: 'butter', quantity: '2 tbsp'}], instructions: ['Render bacon, brown beef in batches', 'Sauté carrots, garlic, add tomato paste', 'Deglaze with wine, add broth and thyme', 'Braise covered 2.5 hours at 325°F', 'Sauté mushrooms and pearl onions in butter, add to stew'], tags: ['dinner', 'french', 'comfort'] },
    { name: 'Philly Cheesesteak Stir-Fry', description: 'Sliced grass-fed beef with sautéed peppers and onions, topped with melted provolone', prep_time_minutes: 15, cook_time_minutes: 15, protein_type: 'beef', dietary_flags: [], sourcing_standard: true, ingredients: [{name: 'beef sirloin', quantity: '1 lb', sourcing_hint: 'grass-fed'}, {name: 'bell pepper', quantity: '2'}, {name: 'onion', quantity: '1 large'}, {name: 'provolone cheese', quantity: '4 slices'}, {name: 'olive oil', quantity: '2 tbsp'}, {name: 'garlic', quantity: '2 cloves'}, {name: 'hoagie roll', quantity: '4'}], instructions: ['Slice beef very thin against grain', 'Sauté peppers and onions in olive oil until soft', 'Add beef and garlic, cook 2 min', 'Top with provolone, cover to melt', 'Serve on hoagie rolls'], tags: ['dinner', 'american'] },
    { name: 'Mongolian Beef', description: 'Crispy-edged grass-fed beef in savory-sweet sauce with broccoli and scallions', prep_time_minutes: 15, cook_time_minutes: 15, protein_type: 'beef', dietary_flags: ['dairy-free'], sourcing_standard: true, ingredients: [{name: 'beef flank steak', quantity: '1 lb', sourcing_hint: 'grass-fed'}, {name: 'broccoli', quantity: '2 cups'}, {name: 'soy sauce', quantity: '0.25 cup'}, {name: 'honey', quantity: '2 tbsp'}, {name: 'rice vinegar', quantity: '1 tbsp'}, {name: 'garlic', quantity: '3 cloves'}, {name: 'ginger', quantity: '1 tbsp'}, {name: 'cornstarch', quantity: '2 tbsp'}, {name: 'scallion', quantity: '3'}, {name: 'sesame oil', quantity: '1 tbsp'}], instructions: ['Slice beef thin, coat with cornstarch', 'Mix soy sauce, honey, vinegar for sauce', 'Sear beef in hot oil until crispy', 'Add broccoli, sauce, ginger, garlic — stir-fry 3 min', 'Finish with sesame oil and scallions'], tags: ['dinner', 'chinese'] },
    // ── Chicken ──
    { name: 'Lemon Herb Roasted Chicken', description: 'Pastured whole chicken roasted with lemon, garlic, and fresh herbs', prep_time_minutes: 20, cook_time_minutes: 60, protein_type: 'chicken', dietary_flags: ['gluten-free', 'dairy-free'], sourcing_standard: true, ingredients: [{name: 'whole chicken', quantity: '4 lbs', sourcing_hint: 'pastured'}, {name: 'lemon', quantity: '2'}, {name: 'garlic', quantity: '1 head'}, {name: 'fresh thyme', quantity: '6 sprigs'}, {name: 'fresh rosemary', quantity: '3 sprigs'}, {name: 'olive oil', quantity: '3 tbsp'}, {name: 'onion', quantity: '1'}, {name: 'carrot', quantity: '2'}], instructions: ['Preheat oven to 425°F', 'Stuff cavity with lemon halves, garlic, herbs', 'Rub skin with olive oil, season generously', 'Roast 60 min until internal 165°F', 'Rest 10 min before carving'], tags: ['dinner', 'sunday'] },
    { name: 'Chicken Stir-Fry with Bok Choy', description: 'Crispy pastured chicken with tender bok choy, ginger, and oyster sauce over rice', prep_time_minutes: 15, cook_time_minutes: 15, protein_type: 'chicken', dietary_flags: ['dairy-free'], sourcing_standard: true, ingredients: [{name: 'chicken breast', quantity: '1.5 lbs', sourcing_hint: 'pastured'}, {name: 'bok choy', quantity: '4 heads'}, {name: 'rice', quantity: '2 cups'}, {name: 'oyster sauce', quantity: '3 tbsp'}, {name: 'soy sauce', quantity: '2 tbsp'}, {name: 'garlic', quantity: '4 cloves'}, {name: 'ginger', quantity: '1 tbsp'}, {name: 'sesame oil', quantity: '1 tbsp'}, {name: 'cornstarch', quantity: '1 tbsp'}], instructions: ['Slice chicken thin, coat with cornstarch', 'Cook rice', 'Stir-fry chicken in hot wok until golden', 'Add bok choy, garlic, ginger, sauces', 'Cook 3-4 min until bok choy is tender', 'Drizzle sesame oil, serve over rice'], tags: ['dinner', 'quick', 'asian'] },
    { name: 'Chicken Piccata', description: 'Pan-seared pastured chicken cutlets in lemon-caper butter sauce with spaghetti', prep_time_minutes: 20, cook_time_minutes: 20, protein_type: 'chicken', dietary_flags: [], sourcing_standard: true, ingredients: [{name: 'chicken breast', quantity: '1.5 lbs', sourcing_hint: 'pastured'}, {name: 'lemon', quantity: '2'}, {name: 'capers', quantity: '3 tbsp'}, {name: 'butter', quantity: '4 tbsp'}, {name: 'garlic', quantity: '3 cloves'}, {name: 'white wine', quantity: '0.5 cup'}, {name: 'chicken broth', quantity: '0.5 cup'}, {name: 'spaghetti', quantity: '12 oz'}, {name: 'flour', quantity: '0.5 cup'}, {name: 'parsley', quantity: '0.25 cup'}], instructions: ['Pound chicken thin, season and flour', 'Sear in butter until golden', 'Add wine, broth, lemon juice, garlic — reduce', 'Stir in capers and parsley', 'Serve over spaghetti'], tags: ['dinner', 'italian'] },
    { name: 'Grilled Chicken Thighs with Salsa Verde', description: 'Pastured chicken thighs with charred salsa verde, served with grilled vegetables', prep_time_minutes: 15, cook_time_minutes: 25, protein_type: 'chicken', dietary_flags: ['gluten-free', 'dairy-free'], sourcing_standard: true, ingredients: [{name: 'chicken thighs', quantity: '2 lbs', sourcing_hint: 'pastured'}, {name: 'tomatillo', quantity: '6'}, {name: 'serrano pepper', quantity: '2'}, {name: 'onion', quantity: '0.5'}, {name: 'cilantro', quantity: '0.5 cup'}, {name: 'lime', quantity: '2'}, {name: 'garlic', quantity: '2 cloves'}, {name: 'olive oil', quantity: '3 tbsp'}, {name: 'zucchini', quantity: '2'}, {name: 'bell pepper', quantity: '1'}], instructions: ['Grill or broil tomatillos, peppers, onion until charred', 'Blend with cilantro, lime, garlic for salsa verde', 'Season and grill chicken thighs 6-7 min per side', 'Grill sliced zucchini and pepper', 'Serve chicken with salsa verde and vegetables'], tags: ['dinner', 'mexican', 'grilling'] },
    { name: 'Thai Basil Chicken', description: 'Wok-fired pastured chicken with holy basil, chilies, and jasmine rice', prep_time_minutes: 15, cook_time_minutes: 10, protein_type: 'chicken', dietary_flags: ['dairy-free'], sourcing_standard: true, ingredients: [{name: 'ground chicken', quantity: '1 lb', sourcing_hint: 'pastured'}, {name: 'thai basil', quantity: '1 cup'}, {name: 'thai chilies', quantity: '4'}, {name: 'garlic', quantity: '5 cloves'}, {name: 'fish sauce', quantity: '2 tbsp'}, {name: 'soy sauce', quantity: '1 tbsp'}, {name: 'oyster sauce', quantity: '1 tbsp'}, {name: 'jasmine rice', quantity: '2 cups'}, {name: 'lime', quantity: '1'}], instructions: ['Cook jasmine rice', 'Pound garlic and chilies in mortar', 'Wok-fry chicken with garlic-chili paste', 'Add fish sauce, soy sauce, oyster sauce', 'Fold in Thai basil, squeeze lime', 'Serve over rice'], tags: ['dinner', 'thai'] },
    { name: 'Coq au Vin Blanc', description: 'Braised pastured chicken in white wine with mushrooms, leeks, and crème fraîche', prep_time_minutes: 25, cook_time_minutes: 45, protein_type: 'chicken', dietary_flags: ['gluten-free'], sourcing_standard: true, ingredients: [{name: 'chicken pieces', quantity: '3 lbs', sourcing_hint: 'pastured'}, {name: 'white wine', quantity: '1 cup'}, {name: 'chicken broth', quantity: '1 cup'}, {name: 'cremini mushrooms', quantity: '8 oz'}, {name: 'leek', quantity: '2'}, {name: 'bacon', quantity: '4 oz'}, {name: 'crème fraîche', quantity: '0.5 cup'}, {name: 'garlic', quantity: '4 cloves'}, {name: 'thyme', quantity: '4 sprigs'}, {name: 'butter', quantity: '2 tbsp'}], instructions: ['Render bacon, brown chicken pieces', 'Sauté leeks and mushrooms', 'Deglaze with wine, add broth and thyme', 'Braise covered 35 min', 'Stir in crème fraîche and butter', 'Serve with crusty bread'], tags: ['dinner', 'french'] },
    { name: 'Chicken Enchiladas Verdes', description: 'Shredded pastured chicken in corn tortillas with tomatillo salsa and queso fresco', prep_time_minutes: 25, cook_time_minutes: 30, protein_type: 'chicken', dietary_flags: ['gluten-free'], sourcing_standard: true, ingredients: [{name: 'chicken breast', quantity: '1.5 lbs', sourcing_hint: 'pastured'}, {name: 'tomatillo', quantity: '1 lb'}, {name: 'serrano pepper', quantity: '3'}, {name: 'onion', quantity: '1'}, {name: 'cilantro', quantity: '0.5 cup'}, {name: 'corn tortillas', quantity: '8'}, {name: 'queso fresco', quantity: '4 oz'}, {name: 'garlic', quantity: '3 cloves'}, {name: 'sour cream', quantity: '0.5 cup'}], instructions: ['Poach and shred chicken', 'Char tomatillos, peppers, half onion under broiler', 'Blend with cilantro, garlic for salsa verde', 'Warm tortillas, fill with chicken, roll', 'Top with salsa, queso fresco, bake 20 min at 375°F'], tags: ['dinner', 'mexican'] },
    { name: 'Prosciutto-Wrapped Chicken Breast', description: 'Pastured chicken stuffed with fontina and spinach, wrapped in prosciutto', prep_time_minutes: 20, cook_time_minutes: 25, protein_type: 'chicken', dietary_flags: ['gluten-free'], sourcing_standard: true, ingredients: [{name: 'chicken breast', quantity: '4', sourcing_hint: 'pastured'}, {name: 'prosciutto', quantity: '8 slices'}, {name: 'fontina cheese', quantity: '4 oz'}, {name: 'spinach', quantity: '2 cups'}, {name: 'garlic', quantity: '3 cloves'}, {name: 'olive oil', quantity: '2 tbsp'}, {name: 'white wine', quantity: '0.25 cup'}, {name: 'butter', quantity: '2 tbsp'}], instructions: ['Sauté spinach and garlic until wilted', 'Pound chicken thin, season', 'Layer fontina and spinach on each breast, roll', 'Wrap tightly with prosciutto', 'Sear seam-side down, bake at 400°F 20 min', 'Rest 5 min, slice'], tags: ['dinner', 'italian', 'elegant'] },
    { name: 'Chicken Tikka Masala', description: 'Pastured chicken in spiced tomato cream sauce, served with basmati rice and naan', prep_time_minutes: 20, cook_time_minutes: 30, protein_type: 'chicken', dietary_flags: [], sourcing_standard: true, ingredients: [{name: 'chicken breast', quantity: '1.5 lbs', sourcing_hint: 'pastured'}, {name: 'tomatoes', quantity: '2 cans diced'}, {name: 'heavy cream', quantity: '0.5 cup'}, {name: 'onion', quantity: '1 large'}, {name: 'garlic', quantity: '4 cloves'}, {name: 'ginger', quantity: '1 tbsp'}, {name: 'garam masala', quantity: '2 tbsp'}, {name: 'cumin', quantity: '1 tsp'}, {name: 'paprika', quantity: '1 tbsp'}, {name: 'butter', quantity: '2 tbsp'}, {name: 'basmati rice', quantity: '2 cups'}], instructions: ['Sauté onion in butter until golden', 'Add garlic, ginger, spices — cook 1 min', 'Add tomatoes, simmer 15 min', 'Add sliced chicken, cook 10 min', 'Stir in cream, serve over rice'], tags: ['dinner', 'indian'] },
    { name: 'Crispy Chicken Cutlet Milanese', description: 'Pan-fried pastured chicken cutlets with panko and parmesan, served with arugula salad', prep_time_minutes: 15, cook_time_minutes: 15, protein_type: 'chicken', dietary_flags: [], sourcing_standard: true, ingredients: [{name: 'chicken breast', quantity: '4', sourcing_hint: 'pastured'}, {name: 'panko breadcrumbs', quantity: '1 cup'}, {name: 'parmesan', quantity: '0.5 cup'}, {name: 'egg', quantity: '2'}, {name: 'arugula', quantity: '4 cups'}, {name: 'lemon', quantity: '1'}, {name: 'olive oil', quantity: '0.5 cup'}, {name: 'garlic', quantity: '2 cloves'}], instructions: ['Pound chicken thin', 'Bread: egg, then panko-parmesan mix', 'Fry in olive oil 3-4 min per side until golden', 'Toss arugula with lemon juice, garlic, olive oil', 'Serve cutlets over arugula with lemon wedges'], tags: ['dinner', 'italian'] },
    // ── Fish / Seafood ──
    { name: 'Pan-Seared Salmon with Lemon & Capers', description: 'Wild-caught salmon with crispy skin, lemon-caper pan sauce, and asparagus', prep_time_minutes: 15, cook_time_minutes: 15, protein_type: 'fish', dietary_flags: ['gluten-free'], sourcing_standard: true, ingredients: [{name: 'salmon fillet', quantity: '1.5 lbs', sourcing_hint: 'wild-caught'}, {name: 'lemon', quantity: '2'}, {name: 'capers', quantity: '2 tbsp'}, {name: 'butter', quantity: '3 tbsp'}, {name: 'garlic', quantity: '2 cloves'}, {name: 'asparagus', quantity: '1 bunch'}, {name: 'olive oil', quantity: '2 tbsp'}, {name: 'parsley', quantity: '2 tbsp'}], instructions: ['Pat salmon dry, season with salt and pepper', 'Sear skin-side down in hot oil 4 min until crispy', 'Flip, add butter, garlic, lemon juice, capers', 'Baste 3 min, serve with asparagus'], tags: ['dinner', 'quick', 'elegant'] },
    { name: 'Blackened Fish Tacos', description: 'Crispy blackened tilapia in corn tortillas with jicama slaw and chipotle crema', prep_time_minutes: 20, cook_time_minutes: 10, protein_type: 'fish', dietary_flags: ['gluten-free'], sourcing_standard: true, ingredients: [{name: 'tilapia fillet', quantity: '1.5 lbs', sourcing_hint: 'wild-caught'}, {name: 'corn tortillas', quantity: '8'}, {name: 'jicama', quantity: '1 cup shredded'}, {name: 'cabbage', quantity: '2 cups shredded'}, {name: 'chipotle in adobo', quantity: '2 tbsp'}, {name: 'sour cream', quantity: '0.5 cup'}, {name: 'lime', quantity: '2'}, {name: 'cumin', quantity: '1 tsp'}, {name: 'paprika', quantity: '1 tbsp'}], instructions: ['Mix sour cream with chipotle for crema', 'Toss jicama and cabbage with lime juice and cilantro', 'Season fish with cumin, paprika, salt', 'Sear in hot skillet 2-3 min per side until blackened', 'Assemble tacos with slaw and crema'], tags: ['dinner', 'mexican', 'seafood'] },
    { name: 'Grilled Gulf Shrimp', description: 'Wild-caught shrimp with chimichurri, grilled squash, and quinoa', prep_time_minutes: 15, cook_time_minutes: 10, protein_type: 'seafood', dietary_flags: ['gluten-free', 'dairy-free'], sourcing_standard: true, ingredients: [{name: 'shrimp', quantity: '1.5 lbs', sourcing_hint: 'wild-caught gulf'}, {name: 'parsley', quantity: '0.5 cup'}, {name: 'cilantro', quantity: '0.25 cup'}, {name: 'garlic', quantity: '4 cloves'}, {name: 'red wine vinegar', quantity: '2 tbsp'}, {name: 'olive oil', quantity: '0.5 cup'}, {name: 'zucchini', quantity: '2'}, {name: 'quinoa', quantity: '1 cup'}], instructions: ['Make chimichurri: blend parsley, cilantro, garlic, vinegar, oil', 'Cook quinoa', 'Grill zucchini slices', 'Thread shrimp, grill 1-2 min per side', 'Serve with quinoa, zucchini, chimichurri'], tags: ['dinner', 'grilling', 'healthy'] },
    { name: 'Miso-Glazed Cod', description: 'Wild cod with sweet white miso glaze, served over soba noodles with edamame', prep_time_minutes: 15, cook_time_minutes: 15, protein_type: 'fish', dietary_flags: ['dairy-free'], sourcing_standard: true, ingredients: [{name: 'cod fillet', quantity: '1.5 lbs', sourcing_hint: 'wild-caught'}, {name: 'white miso', quantity: '3 tbsp'}, {name: 'mirin', quantity: '2 tbsp'}, {name: 'soy sauce', quantity: '1 tbsp'}, {name: 'soba noodles', quantity: '8 oz'}, {name: 'edamame', quantity: '1 cup'}, {name: 'scallion', quantity: '3'}, {name: 'sesame oil', quantity: '1 tbsp'}], instructions: ['Mix miso, mirin, soy sauce for glaze', 'Broil cod with glaze until caramelized, 8-10 min', 'Cook soba noodles', 'Toss noodles with edamame and sesame oil', 'Serve fish over noodles with scallions'], tags: ['dinner', 'japanese'] },
    { name: 'Coconut Curry Fish', description: 'Wild-caught fish in coconut curry with snap peas, served over jasmine rice', prep_time_minutes: 15, cook_time_minutes: 20, protein_type: 'fish', dietary_flags: ['gluten-free', 'dairy-free'], sourcing_standard: true, ingredients: [{name: 'snapper fillet', quantity: '1.5 lbs', sourcing_hint: 'wild-caught'}, {name: 'coconut milk', quantity: '1 can'}, {name: 'red curry paste', quantity: '2 tbsp'}, {name: 'snap peas', quantity: '1 cup'}, {name: 'bell pepper', quantity: '1'}, {name: 'jasmine rice', quantity: '2 cups'}, {name: 'fish sauce', quantity: '1 tbsp'}, {name: 'lime', quantity: '1'}, {name: 'basil', quantity: '0.25 cup'}, {name: 'garlic', quantity: '3 cloves'}], instructions: ['Cook jasmine rice', 'Sauté curry paste and garlic 1 min', 'Add coconut milk, fish sauce, bring to simmer', 'Add fish, snap peas, pepper — cook 8 min', 'Finish with lime juice and basil, serve over rice'], tags: ['dinner', 'thai'] },
    { name: 'Smoked Trout Kedgeree', description: 'Flaked smoked trout with spiced rice, hard-boiled eggs, and fresh herbs', prep_time_minutes: 20, cook_time_minutes: 25, protein_type: 'fish', dietary_flags: ['gluten-free'], sourcing_standard: true, ingredients: [{name: 'smoked trout', quantity: '12 oz', sourcing_hint: 'wild-caught'}, {name: 'basmati rice', quantity: '1.5 cups'}, {name: 'egg', quantity: '4'}, {name: 'onion', quantity: '1'}, {name: 'garlic', quantity: '2 cloves'}, {name: 'curry powder', quantity: '1 tbsp'}, {name: 'bay leaf', quantity: '2'}, {name: 'parsley', quantity: '0.25 cup'}, {name: 'lemon', quantity: '1'}], instructions: ['Cook rice with bay leaf', 'Hard-boil eggs, quarter', 'Sauté onion and garlic, add curry powder', 'Flake trout into rice, fold in eggs', 'Finish with lemon juice and parsley'], tags: ['dinner', 'british'] },
    { name: 'Grilled Swordfish with Herb Oil', description: 'Wild swordfish steak with charred lemon and herb oil, served with roasted tomatoes', prep_time_minutes: 10, cook_time_minutes: 15, protein_type: 'fish', dietary_flags: ['gluten-free', 'dairy-free'], sourcing_standard: true, ingredients: [{name: 'swordfish steak', quantity: '1.5 lbs', sourcing_hint: 'wild-caught'}, {name: 'lemon', quantity: '2'}, {name: 'fresh oregano', quantity: '2 tbsp'}, {name: 'fresh thyme', quantity: '1 tbsp'}, {name: 'olive oil', quantity: '0.25 cup'}, {name: 'garlic', quantity: '3 cloves'}, {name: 'cherry tomato', quantity: '2 cups'}, {name: 'capers', quantity: '2 tbsp'}], instructions: ['Make herb oil: blend oregano, thyme, garlic, oil, lemon zest', 'Grill swordfish 3-4 min per side', 'Char tomatoes under broiler', 'Serve fish with herb oil, tomatoes, capers'], tags: ['dinner', 'mediterranean'] },
    { name: 'Crab Cakes with Remoulade', description: 'Pan-seared wild crab cakes with Cajun remoulade and mixed greens', prep_time_minutes: 25, cook_time_minutes: 15, protein_type: 'seafood', dietary_flags: [], sourcing_standard: true, ingredients: [{name: 'crab meat', quantity: '1 lb', sourcing_hint: 'wild-caught'}, {name: 'panko breadcrumbs', quantity: '0.5 cup'}, {name: 'egg', quantity: '1'}, {name: 'mayonnaise', quantity: '3 tbsp'}, {name: 'dijon mustard', quantity: '1 tsp'}, {name: 'bell pepper', quantity: '0.5'}, {name: 'scallion', quantity: '2'}, {name: 'parsley', quantity: '2 tbsp'}, {name: 'lemon', quantity: '1'}, {name: 'butter', quantity: '3 tbsp'}], instructions: ['Mix crab, panko, egg, mayo, mustard, peppers, scallions, parsley', 'Form into cakes, refrigerate 15 min', 'Pan-sear in butter 3-4 min per side', 'Serve with remoulade and greens'], tags: ['dinner', 'cajun', 'elegant'] },
    { name: 'Seared Scallops with Brown Butter', description: 'Pan-seared diver scallops with brown butter and lemon, served over risotto', prep_time_minutes: 15, cook_time_minutes: 25, protein_type: 'seafood', dietary_flags: ['gluten-free'], sourcing_standard: true, ingredients: [{name: 'sea scallops', quantity: '1.5 lbs', sourcing_hint: 'wild-caught'}, {name: 'butter', quantity: '4 tbsp'}, {name: 'lemon', quantity: '1'}, {name: 'garlic', quantity: '2 cloves'}, {name: 'arborio rice', quantity: '1.5 cups'}, {name: 'white wine', quantity: '0.5 cup'}, {name: 'parmesan', quantity: '0.5 cup'}, {name: 'chicken broth', quantity: '4 cups'}, {name: 'thyme', quantity: '2 sprigs'}], instructions: ['Make risotto: toast rice, add wine, then broth ladle by ladle', 'Pat scallops dry, season', 'Sear in hot pan 2 min per side until golden', 'Brown butter with lemon juice and garlic', 'Serve scallops over risotto with brown butter'], tags: ['dinner', 'italian', 'elegant'] },
    { name: 'Mackerel en Papillote', description: 'Wild mackerel baked in parchment with fennel, tomato, and white wine', prep_time_minutes: 15, cook_time_minutes: 20, protein_type: 'fish', dietary_flags: ['gluten-free', 'dairy-free'], sourcing_standard: true, ingredients: [{name: 'mackerel fillet', quantity: '1.5 lbs', sourcing_hint: 'wild-caught'}, {name: 'fennel', quantity: '1 bulb'}, {name: 'cherry tomato', quantity: '1 cup'}, {name: 'white wine', quantity: '0.25 cup'}, {name: 'garlic', quantity: '3 cloves'}, {name: 'lemon', quantity: '1'}, {name: 'olive oil', quantity: '2 tbsp'}, {name: 'dill', quantity: '2 tbsp'}], instructions: ['Slice fennel thin', 'Place fish on parchment with fennel, tomatoes, wine, garlic', 'Drizzle olive oil, lemon, dill', 'Fold parchment, bake at 400°F 20 min', 'Serve in parchment for presentation'], tags: ['dinner', 'french', 'healthy'] },
    // ── Pork ──
    { name: 'Herb-Crusted Pork Tenderloin', description: 'Seared pork tenderloin with rosemary-thyme crust and apple-mustard pan sauce', prep_time_minutes: 15, cook_time_minutes: 25, protein_type: 'pork', dietary_flags: ['gluten-free'], sourcing_standard: true, ingredients: [{name: 'pork tenderloin', quantity: '1.5 lbs'}, {name: 'fresh rosemary', quantity: '1 tbsp'}, {name: 'fresh thyme', quantity: '1 tbsp'}, {name: 'garlic', quantity: '3 cloves'}, {name: 'dijon mustard', quantity: '1 tbsp'}, {name: 'apple', quantity: '1'}, {name: 'chicken broth', quantity: '0.5 cup'}, {name: 'butter', quantity: '2 tbsp'}, {name: 'olive oil', quantity: '2 tbsp'}], instructions: ['Season pork with herbs and garlic', 'Sear on all sides in hot oil', 'Roast at 400°F 15-18 min until 145°F internal', 'Make sauce: sauté apple, add broth, mustard, butter', 'Rest pork 5 min, slice, serve with sauce'], tags: ['dinner', 'autumn'] },
    { name: 'Pork Schnitzel', description: 'Crispy breaded pork cutlets with lemon wedges and warm potato salad', prep_time_minutes: 20, cook_time_minutes: 15, protein_type: 'pork', dietary_flags: [], sourcing_standard: true, ingredients: [{name: 'pork cutlet', quantity: '4'}, {name: 'panko breadcrumbs', quantity: '1 cup'}, {name: 'flour', quantity: '0.5 cup'}, {name: 'egg', quantity: '2'}, {name: 'lemon', quantity: '2'}, {name: 'potato', quantity: '1.5 lbs'}, {name: 'cornichon', quantity: '6'}, {name: 'scallion', quantity: '3'}, {name: 'dijon mustard', quantity: '2 tbsp'}, {name: 'olive oil', quantity: '0.5 cup'}], instructions: ['Boil potatoes, dress warm with mustard, cornichons, scallions', 'Bread cutlets: flour, egg, panko', 'Fry in olive oil 3-4 min per side until golden', 'Serve with lemon wedges and potato salad'], tags: ['dinner', 'german'] },
    { name: 'Mojo Pork Shoulder', description: 'Slow-roasted pork shoulder with citrus-mojo sauce, served with black beans and rice', prep_time_minutes: 25, cook_time_minutes: 180, protein_type: 'pork', dietary_flags: ['gluten-free', 'dairy-free'], sourcing_standard: true, ingredients: [{name: 'pork shoulder', quantity: '3 lbs'}, {name: 'orange', quantity: '3'}, {name: 'lime', quantity: '4'}, {name: 'garlic', quantity: '8 cloves'}, {name: 'cumin', quantity: '1 tbsp'}, {name: 'oregano', quantity: '1 tbsp'}, {name: 'olive oil', quantity: '0.25 cup'}, {name: 'black beans', quantity: '1 can'}, {name: 'rice', quantity: '2 cups'}, {name: 'cilantro', quantity: '0.5 cup'}, {name: 'onion', quantity: '1'}], instructions: ['Blend mojo: orange juice, lime juice, garlic, cumin, oregano, oil', 'Score pork, rub with mojo, marinate 2 hours', 'Roast covered at 325°F 3 hours until tender', 'Shred and serve with mojo sauce, black beans, rice, cilantro'], tags: ['dinner', 'cuban'] },
    { name: 'Sticky Glazed Pork Ribs', description: 'Braised then roasted pork ribs with hoisin-char honey glaze', prep_time_minutes: 20, cook_time_minutes: 120, protein_type: 'pork', dietary_flags: ['dairy-free'], sourcing_standard: true, ingredients: [{name: 'pork ribs', quantity: '3 lbs'}, {name: 'hoisin sauce', quantity: '3 tbsp'}, {name: 'honey', quantity: '2 tbsp'}, {name: 'soy sauce', quantity: '2 tbsp'}, {name: 'garlic', quantity: '4 cloves'}, {name: 'ginger', quantity: '1 tbsp'}, {name: 'chicken broth', quantity: '1 cup'}, {name: 'scallion', quantity: '3'}], instructions: ['Braise ribs in broth, garlic, ginger covered 90 min', 'Mix hoisin, honey, soy sauce for glaze', 'Brush ribs with glaze, roast uncovered at 425°F 20 min', 'Brush again halfway through', 'Serve with scallions'], tags: ['dinner', 'asian', 'bbq'] },
    { name: 'Tonkatsu', description: 'Japanese fried pork cutlet with tonkatsu sauce, shredded cabbage, and rice', prep_time_minutes: 15, cook_time_minutes: 15, protein_type: 'pork', dietary_flags: [], sourcing_standard: true, ingredients: [{name: 'pork cutlet', quantity: '4'}, {name: 'panko breadcrumbs', quantity: '1.5 cups'}, {name: 'flour', quantity: '0.5 cup'}, {name: 'egg', quantity: '2'}, {name: 'cabbage', quantity: '1 head'}, {name: 'tonkatsu sauce', quantity: '0.25 cup'}, {name: 'rice', quantity: '2 cups'}, {name: 'sesame oil', quantity: '1 tbsp'}, {name: 'olive oil', quantity: '0.5 cup'}], instructions: ['Shred cabbage very thin, dress with sesame oil and salt', 'Bread cutlets: flour, egg, panko', 'Fry in oil 4-5 min per side until golden', 'Rest 2 min, slice', 'Serve with rice, cabbage, tonkatsu sauce'], tags: ['dinner', 'japanese'] },
    // ── Vegetarian / Plant-Forward ──
    { name: 'Wild Mushroom Risotto', description: 'Arborio risotto with a medley of wild mushrooms, parmesan, and truffle oil', prep_time_minutes: 15, cook_time_minutes: 35, protein_type: 'vegetarian', dietary_flags: ['gluten-free'], sourcing_standard: false, ingredients: [{name: 'arborio rice', quantity: '1.5 cups'}, {name: 'cremini mushrooms', quantity: '8 oz'}, {name: 'shiitake mushrooms', quantity: '4 oz'}, {name: 'white wine', quantity: '0.5 cup'}, {name: 'parmesan', quantity: '0.75 cup'}, {name: 'chicken broth', quantity: '6 cups'}, {name: 'shallot', quantity: '2'}, {name: 'garlic', quantity: '2 cloves'}, {name: 'butter', quantity: '4 tbsp'}, {name: 'truffle oil', quantity: '1 tbsp'}], instructions: ['Sauté mushrooms until golden, set aside', 'Toast rice with shallot and garlic', 'Add wine, stir until absorbed', 'Add broth ladle by ladle, stirring 20 min', 'Fold in mushrooms, parmesan, butter', 'Drizzle truffle oil to serve'], tags: ['dinner', 'italian', 'vegetarian'] },
    { name: 'Heirloom Tomato Pasta', description: 'Penne with roasted heirloom tomatoes, fresh basil, garlic, and burrata', prep_time_minutes: 15, cook_time_minutes: 25, protein_type: 'vegetarian', dietary_flags: [], sourcing_standard: false, ingredients: [{name: 'penne', quantity: '12 oz'}, {name: 'heirloom tomatoes', quantity: '2 lbs'}, {name: 'burrata', quantity: '8 oz'}, {name: 'basil', quantity: '0.5 cup'}, {name: 'garlic', quantity: '5 cloves'}, {name: 'olive oil', quantity: '0.25 cup'}, {name: 'red pepper flakes', quantity: '0.5 tsp'}, {name: 'parmesan', quantity: '0.5 cup'}], instructions: ['Halve tomatoes, roast at 425°F 20 min with garlic', 'Cook penne', 'Toss pasta with olive oil, tomatoes, garlic', 'Add basil, red pepper flakes', 'Top with torn burrata and parmesan'], tags: ['dinner', 'italian', 'vegetarian', 'summer'] },
    { name: 'Black Bean Enchiladas', description: 'Corn tortilla enchiladas with black beans, roasted peppers, and red chili sauce', prep_time_minutes: 25, cook_time_minutes: 30, protein_type: 'vegetarian', dietary_flags: ['gluten-free'], sourcing_standard: false, ingredients: [{name: 'black beans', quantity: '2 cans'}, {name: 'corn tortillas', quantity: '8'}, {name: 'bell pepper', quantity: '2'}, {name: 'onion', quantity: '1'}, {name: 'red enchilada sauce', quantity: '2 cups'}, {name: 'cheddar cheese', quantity: '1 cup'}, {name: 'sour cream', quantity: '0.5 cup'}, {name: 'cilantro', quantity: '0.25 cup'}, {name: 'cumin', quantity: '1 tsp'}, {name: 'garlic', quantity: '3 cloves'}], instructions: ['Sauté peppers and onions, add beans, cumin, garlic', 'Warm tortillas, fill with bean mixture', 'Roll and place in baking dish', 'Top with enchilada sauce and cheddar', 'Bake at 375°F 25 min', 'Serve with sour cream and cilantro'], tags: ['dinner', 'mexican', 'vegetarian'] },
    { name: 'Eggplant Parmesan', description: 'Crispy baked eggplant with San Marzano tomato sauce and fresh mozzarella', prep_time_minutes: 30, cook_time_minutes: 35, protein_type: 'vegetarian', dietary_flags: [], sourcing_standard: false, ingredients: [{name: 'eggplant', quantity: '2 large'}, {name: 'marinara sauce', quantity: '3 cups'}, {name: 'fresh mozzarella', quantity: '8 oz'}, {name: 'parmesan', quantity: '0.5 cup'}, {name: 'panko breadcrumbs', quantity: '0.75 cup'}, {name: 'egg', quantity: '2'}, {name: 'olive oil', quantity: '3 tbsp'}, {name: 'fresh basil', quantity: '0.25 cup'}, {name: 'garlic', quantity: '3 cloves'}], instructions: ['Slice eggplant, salt and rest 20 min', 'Bread: egg then panko-parmesan', 'Bake on sheet at 425°F 20 min until golden', 'Layer in baking dish: sauce, eggplant, mozzarella', 'Bake 15 min until bubbly', 'Top with basil'], tags: ['dinner', 'italian', 'vegetarian'] },
    { name: 'Chickpea Tikka', description: 'Chickpeas in spiced tomato cream sauce, served with basmati rice and naan', prep_time_minutes: 15, cook_time_minutes: 25, protein_type: 'vegetarian', dietary_flags: [], sourcing_standard: false, ingredients: [{name: 'chickpeas', quantity: '2 cans'}, {name: 'tomatoes', quantity: '1 can diced'}, {name: 'coconut milk', quantity: '0.5 cup'}, {name: 'onion', quantity: '1 large'}, {name: 'garlic', quantity: '4 cloves'}, {name: 'ginger', quantity: '1 tbsp'}, {name: 'garam masala', quantity: '2 tbsp'}, {name: 'cumin', quantity: '1 tsp'}, {name: 'basmati rice', quantity: '2 cups'}, {name: 'butter', quantity: '2 tbsp'}], instructions: ['Sauté onion in butter until golden', 'Add garlic, ginger, spices — cook 1 min', 'Add tomatoes, simmer 15 min', 'Add chickpeas, cook 5 min', 'Stir in coconut milk', 'Serve over rice'], tags: ['dinner', 'indian', 'vegetarian'] },
    { name: 'Zucchini Noodle Primavera', description: 'Spiralized zucchini with seasonal vegetables, cherry tomatoes, and herb pesto', prep_time_minutes: 20, cook_time_minutes: 10, protein_type: 'vegetarian', dietary_flags: ['gluten-free', 'dairy-free'], sourcing_standard: false, ingredients: [{name: 'zucchini', quantity: '4'}, {name: 'cherry tomato', quantity: '1 cup'}, {name: 'bell pepper', quantity: '1'}, {name: 'broccoli', quantity: '1 cup'}, {name: 'basil', quantity: '0.5 cup'}, {name: 'pine nuts', quantity: '3 tbsp'}, {name: 'garlic', quantity: '2 cloves'}, {name: 'olive oil', quantity: '0.25 cup'}, {name: 'lemon', quantity: '1'}], instructions: ['Spiralize zucchini into noodles', 'Blend basil, pine nuts, garlic, oil, lemon for pesto', 'Sauté broccoli and pepper until tender-crisp', 'Toss zucchini noodles with vegetables and tomatoes', 'Top with pesto'], tags: ['dinner', 'vegetarian', 'low-carb', 'healthy'] },
    { name: 'Stuffed Bell Peppers', description: 'Poblano and bell peppers stuffed with black beans, corn, quinoa, and melted cheese', prep_time_minutes: 25, cook_time_minutes: 35, protein_type: 'vegetarian', dietary_flags: ['gluten-free'], sourcing_standard: false, ingredients: [{name: 'bell pepper', quantity: '4'}, {name: 'black beans', quantity: '1 can'}, {name: 'corn', quantity: '0.5 cup'}, {name: 'quinoa', quantity: '1 cup'}, {name: 'cheddar cheese', quantity: '0.75 cup'}, {name: 'onion', quantity: '1'}, {name: 'garlic', quantity: '3 cloves'}, {name: 'cumin', quantity: '1 tsp'}, {name: 'cilantro', quantity: '0.25 cup'}, {name: 'lime', quantity: '1'}], instructions: ['Cook quinoa', 'Mix with beans, corn, half the cheese, onion, garlic, cumin', 'Hollow peppers, fill with mixture', 'Place in baking dish, top with remaining cheese', 'Bake at 375°F 35 min', 'Garnish with cilantro and lime'], tags: ['dinner', 'mexican', 'vegetarian'] },
    { name: 'Cauliflower Steak with Chimichurri', description: 'Roasted cauliflower steak with vibrant green chimichurri and toasted almonds', prep_time_minutes: 15, cook_time_minutes: 25, protein_type: 'vegetarian', dietary_flags: ['gluten-free', 'dairy-free'], sourcing_standard: false, ingredients: [{name: 'cauliflower', quantity: '1 large head'}, {name: 'parsley', quantity: '0.5 cup'}, {name: 'cilantro', quantity: '0.25 cup'}, {name: 'garlic', quantity: '4 cloves'}, {name: 'red wine vinegar', quantity: '2 tbsp'}, {name: 'olive oil', quantity: '0.33 cup'}, {name: 'almonds', quantity: '3 tbsp'}, {name: 'lemon', quantity: '1'}], instructions: ['Slice cauliflower into 1-inch steaks', 'Roast at 425°F 25 min until golden', 'Make chimichurri: blend parsley, cilantro, garlic, vinegar, oil', 'Toast almonds in dry pan', 'Serve cauliflower with chimichurri and almonds'], tags: ['dinner', 'vegetarian', 'vegan', 'healthy'] },
    { name: "Lentil Shepherd's Pie", description: 'Brown lentil and vegetable filling under creamy mashed potato topping', prep_time_minutes: 30, cook_time_minutes: 40, protein_type: 'vegetarian', dietary_flags: ['gluten-free'], sourcing_standard: false, ingredients: [{name: 'lentils', quantity: '1.5 cups'}, {name: 'potato', quantity: '2 lbs'}, {name: 'onion', quantity: '1 large'}, {name: 'carrot', quantity: '2'}, {name: 'celery', quantity: '2 stalks'}, {name: 'peas', quantity: '1 cup'}, {name: 'tomato paste', quantity: '2 tbsp'}, {name: 'vegetable broth', quantity: '2 cups'}, {name: 'butter', quantity: '4 tbsp'}, {name: 'milk', quantity: '0.5 cup'}, {name: 'garlic', quantity: '3 cloves'}], instructions: ['Cook lentils in broth until tender', 'Sauté onion, carrot, celery — add tomato paste and lentils', 'Spread in baking dish, top with mashed potatoes', 'Dot with butter, bake at 400°F 20 min until golden'], tags: ['dinner', 'british', 'vegetarian', 'comfort'] },
    { name: 'Farro & Roasted Vegetable Bowl', description: 'Toasted farro with roasted root vegetables, tahini dressing, and fresh herbs', prep_time_minutes: 20, cook_time_minutes: 35, protein_type: 'vegetarian', dietary_flags: ['dairy-free'], sourcing_standard: false, ingredients: [{name: 'farro', quantity: '1.5 cups'}, {name: 'sweet potato', quantity: '2'}, {name: 'beet', quantity: '2'}, {name: 'kale', quantity: '3 cups'}, {name: 'tahini', quantity: '3 tbsp'}, {name: 'lemon', quantity: '2'}, {name: 'garlic', quantity: '2 cloves'}, {name: 'olive oil', quantity: '3 tbsp'}, {name: 'parsley', quantity: '0.25 cup'}], instructions: ['Cook farro until tender', 'Roast cubed sweet potato and beets at 425°F 30 min', 'Massage kale with olive oil and lemon', 'Make dressing: tahini, lemon, garlic, water', 'Assemble bowls with farro, vegetables, kale, dressing'], tags: ['dinner', 'vegetarian', 'healthy', 'grain-bowl'] },
    // ── Eggs / Breakfast for Dinner ──
    { name: 'Shakshuka', description: 'Eggs poached in spiced tomato sauce with feta, served with warm pita', prep_time_minutes: 15, cook_time_minutes: 25, protein_type: 'eggs', dietary_flags: ['vegetarian'], sourcing_standard: false, ingredients: [{name: 'egg', quantity: '6'}, {name: 'tomatoes', quantity: '2 cans crushed'}, {name: 'feta cheese', quantity: '4 oz'}, {name: 'onion', quantity: '1 large'}, {name: 'bell pepper', quantity: '1'}, {name: 'garlic', quantity: '4 cloves'}, {name: 'cumin', quantity: '1 tsp'}, {name: 'paprika', quantity: '1 tsp'}, {name: 'olive oil', quantity: '2 tbsp'}, {name: 'pita', quantity: '4'}], instructions: ['Sauté onion and pepper until soft', 'Add garlic, cumin, paprika — cook 1 min', 'Add tomatoes, simmer 15 min', 'Create wells, crack in eggs', 'Cover and cook 7-8 min until whites set', 'Top with feta, serve with pita'], tags: ['dinner', 'breakfast-for-dinner', 'vegetarian', 'middle-eastern'] },
    { name: 'Frittata with Asparagus & Gruyere', description: 'Oven-baked frittata with fresh asparagus, gruyere, and herbs', prep_time_minutes: 15, cook_time_minutes: 25, protein_type: 'eggs', dietary_flags: ['gluten-free', 'vegetarian'], sourcing_standard: false, ingredients: [{name: 'egg', quantity: '10'}, {name: 'asparagus', quantity: '1 bunch'}, {name: 'gruyere cheese', quantity: '4 oz'}, {name: 'shallot', quantity: '2'}, {name: 'butter', quantity: '2 tbsp'}, {name: 'heavy cream', quantity: '0.25 cup'}, {name: 'fresh chives', quantity: '2 tbsp'}, {name: 'fresh thyme', quantity: '1 tsp'}], instructions: ['Trim asparagus, cut in half', 'Whisk eggs with cream, salt, pepper', 'Melt butter in oven-safe skillet, sauté asparagus and shallot', 'Pour in egg mixture, top with gruyere', 'Bake at 375°F 20 min until set', 'Garnish with chives and thyme'], tags: ['dinner', 'italian', 'vegetarian'] },
    { name: 'Mushroom & Spinach Scramble', description: 'Pasture-raised eggs scrambled with wild mushrooms, spinach, and crème fraîche', prep_time_minutes: 10, cook_time_minutes: 10, protein_type: 'eggs', dietary_flags: ['gluten-free', 'vegetarian'], sourcing_standard: false, ingredients: [{name: 'egg', quantity: '6', sourcing_hint: 'pasture-raised'}, {name: 'cremini mushrooms', quantity: '8 oz'}, {name: 'spinach', quantity: '3 cups'}, {name: 'crème fraîche', quantity: '3 tbsp'}, {name: 'butter', quantity: '2 tbsp'}, {name: 'chives', quantity: '2 tbsp'}, {name: 'garlic', quantity: '2 cloves'}], instructions: ['Sauté mushrooms in butter until golden', 'Add garlic, cook 30 sec', 'Add spinach, stir until wilted', 'Whisk eggs, pour in, scramble gently over low heat', 'Fold in crème fraîche', 'Serve with chives'], tags: ['dinner', 'quick', 'vegetarian'] },
    { name: 'Lamb Flatiron with Chimichurri', description: 'Grass-fed lamb flatiron with bright herb chimichurri, roasted carrots, and farro', prep_time_minutes: 20, cook_time_minutes: 25, protein_type: 'lamb', dietary_flags: ['gluten-free', 'dairy-free'], sourcing_standard: true, ingredients: [{name: 'lamb flatiron', quantity: '1.5 lbs', sourcing_hint: 'grass-fed'}, {name: 'carrot', quantity: '4'}, {name: 'farro', quantity: '1 cup'}, {name: 'parsley', quantity: '0.5 cup'}, {name: 'cilantro', quantity: '0.25 cup'}, {name: 'garlic', quantity: '4 cloves'}, {name: 'red wine vinegar', quantity: '2 tbsp'}, {name: 'olive oil', quantity: '0.33 cup'}, {name: 'cumin', quantity: '1 tsp'}, {name: 'lemon', quantity: '1'}], instructions: ['Cook farro', 'Toss carrots with oil, roast at 425°F 25 min', 'Season lamb, sear in hot pan 3-4 min per side', 'Rest 5 min', 'Blend chimichurri: parsley, cilantro, garlic, vinegar, oil, cumin', 'Slice lamb, serve with farro, carrots, chimichurri'], tags: ['dinner', 'grilling'] }
  ];
}

module.exports = router;
