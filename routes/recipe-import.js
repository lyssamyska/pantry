// Import recipe from URL endpoint group.
const express = require('express');
const router = express.Router();
const { importRecipeFromUrl } = require('../services/recipe-importer');
const recipeImportDb = require('../db/recipe-import');
const plansDb = require('../db/meal-plans');
const recipesDb = require('../db/recipes');
const pantryDb = require('../db/pantry-items');
const pricesDb = require('../db/prices');
const { buildGroceryList } = require('../services/meal-planner');
const { rejectMismatchedUserId, requireAuth } = require('../lib/require-auth');

router.use(requireAuth, rejectMismatchedUserId);

async function rebuildPlanGroceries(plan, days) {
  const pantryItems = plan.user_id ? await pantryDb.getPantryItems(plan.user_id) : [];
  const csaItems = plan.user_id ? await pantryDb.getCsaItems(plan.user_id) : [];
  const recipes = days
    .filter(day => day && day.recipe_id != null)
    .map(day => ({ name: day.meal, base_servings: day.base_servings || 4, ingredients: day.ingredients || [] }));
  const groceryList = await buildGroceryList(recipes, pricesDb, pantryItems, csaItems, plan.servings || 2);

  const previousRows = await plansDb.getGroceryList(plan.id);
  const previousItems = new Map();
  const customItems = [];
  for (const row of previousRows) {
    for (const item of row.items || []) {
      if (row.category === 'Custom items') {
        if (item && item.is_custom) customItems.push({ ...item });
        continue;
      }
      if (item && item.is_custom) continue;
      if (item && item.name && !previousItems.has(item.name.toLowerCase())) previousItems.set(item.name.toLowerCase(), item);
    }
  }
  for (const items of Object.values(groceryList)) {
    for (const item of items) {
      const previous = previousItems.get(String(item.name || '').toLowerCase());
      if (!previous) continue;
      if (Object.prototype.hasOwnProperty.call(previous, 'checked')) item.checked = previous.checked;
      if (Object.prototype.hasOwnProperty.call(previous, 'note')) item.note = previous.note;
    }
  }
  if (customItems.length) groceryList['Custom items'] = customItems;

  await plansDb.saveMealPlanAndGroceryList(plan.id, days, groceryList);
  return groceryList;
}

// POST /api/recipe-import/preview
// Fetches URL, parses recipe, returns preview (does NOT save yet).
// Body: { url: string }
router.post('/preview', async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url) return res.status(400).json({ error: 'URL is required' });

    const recipe = await importRecipeFromUrl(url.trim());
    res.json({ success: true, recipe });
  } catch (err) {
    console.error('[/api/recipe-import/preview]', err.message);
    res.status(422).json({ error: err.message });
  }
});

// POST /api/recipe-import/save
// Saves a parsed recipe to the user's recipe pool.
// Body: { recipe: { name, ingredients, instructions, ... }, userId? }
router.post('/save', async (req, res) => {
  try {
    const { recipe } = req.body || {};
    if (!recipe) return res.status(400).json({ error: 'Recipe data is required' });

    const saved = await recipeImportDb.saveImportedRecipe(recipe);
    res.json({
      success: true,
      id: saved.id,
      name: saved.name,
      source_url: saved.source_url,
      imported_at: saved.imported_at,
    });
  } catch (err) {
    console.error('[/api/recipe-import/save]', err);
    res.status(500).json({ error: 'Failed to save recipe' });
  }
});

// POST /api/recipe-import/save-and-slot
// Saves a parsed recipe AND adds it to the current week's plan.
// Body: { recipe: { name, ingredients, instructions, ... } }
router.post('/save-and-slot', async (req, res) => {
  try {
    const userId = req.authenticatedUserId;
    const { recipe } = req.body || {};
    if (!recipe) return res.status(400).json({ error: 'Recipe data is required' });

    const saved = await recipeImportDb.saveImportedRecipe(recipe);
    const latestPlan = await plansDb.getLatestPlan(userId);

    let slotResult = null;
    if (latestPlan) {
      slotResult = await plansDb.addRecipeToDay(latestPlan.id, saved.id, saved);
      if (slotResult) {
        const groceryList = await rebuildPlanGroceries(latestPlan, slotResult.days);
        slotResult = { ...slotResult, grocery_list: groceryList, servings: latestPlan.servings || 2 };
      }
    }

    res.json({
      success: true,
      id: saved.id,
      name: saved.name,
      source_url: saved.source_url,
      imported_at: saved.imported_at,
      slot: slotResult,
    });
  } catch (err) {
    console.error('[/api/recipe-import/save-and-slot]', err);
    res.status(500).json({ error: 'Failed to save and add to plan' });
  }
});

// POST /api/recipe-import/add-to-plan
// Adds a previously-saved recipe to the current week's plan.
// Body: { recipeId: number }
router.post('/add-to-plan', async (req, res) => {
  try {
    const userId = req.authenticatedUserId;
    const { recipeId } = req.body || {};
    if (!recipeId) return res.status(400).json({ error: 'recipeId is required' });

    const recipe = await recipesDb.getRecipeById(recipeId);
    if (!recipe) return res.status(404).json({ error: 'Recipe not found' });

    let plan = await plansDb.getLatestPlan(userId);
    if (!plan) {
      // No plan yet — generate a minimal 7-day empty plan to populate
      const generated = await generateEmptyPlan();
      const savedPlan = await plansDb.createMealPlan(userId, 'Weekly Meal Plan', generated.days, null, 2);
      plan = savedPlan;
    }

    const slot = await plansDb.addRecipeToDay(plan.id, recipeId, recipe);
    const groceryList = slot ? await rebuildPlanGroceries(plan, slot.days) : {};
    res.json({ success: true, plan_id: plan.id, slot: slot ? { ...slot, grocery_list: groceryList, servings: plan.servings || 2 } : null });
  } catch (err) {
    console.error('[/api/recipe-import/add-to-plan]', err);
    res.status(500).json({ error: 'Failed to add recipe to plan' });
  }
});

function generateEmptyPlan() {
  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  return {
    days: DAYS.map(day => ({ day, recipe_id: null, meal: '', description: '', prep_time: 0, protein_type: null, ingredients: [], tags: [] }))
  };
}

module.exports = router;
