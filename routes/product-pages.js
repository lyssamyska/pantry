const express = require('express');
const plansDb = require('../db/meal-plans');
const pantryDb = require('../db/pantry-items');
const { getUserById } = require('../db/users');
const { getUserIdFromCookie } = require('../lib/user-session');
const {
  AUSTIN_RETAILER_DISPLAY_NAMES,
  isSupportedAustinStoreName,
} = require('../lib/austin-retailers');

const router = express.Router();

router.get('/planner', async (req, res) => {
  const userId = getUserIdFromCookie(req);

  if (userId) {
    try {
      const user = await getUserById(userId);
      if (user && !user.onboarding_completed) return res.redirect('/onboarding');
      return res.render('planner', {
        title: 'Meal Planner — Pantry',
        userId,
        dietPreferences: user?.diet_preferences || [],
        mealCountDefaults: user?.meal_count_defaults || {},
        supportedAustinStoreNames: [...AUSTIN_RETAILER_DISPLAY_NAMES],
      });
    } catch (err) {
      console.error('[/planner] user lookup error:', err);
    }
  }

  return res.render('planner', {
    title: 'Meal Planner — Pantry',
    userId: null,
    dietPreferences: [],
    mealCountDefaults: {},
    supportedAustinStoreNames: [...AUSTIN_RETAILER_DISPLAY_NAMES],
  });
});

router.get('/planner/export', async (req, res) => {
  const userId = getUserIdFromCookie(req);

  let planId = null;
  let byCategory = {};
  let byStore = { stores: {}, other: [], pantry: [], csa: [] };
  try {
    const plan = await plansDb.getLatestPlan(userId);
    if (plan) {
      planId = plan.id;
      const rows = await plansDb.getGroceryList(plan.id);
      byCategory = Object.fromEntries(rows.map((row) => [row.category, row.items || []]));

      const stores = {};
      const other = [];
      const pantry = [];
      const csa = [];
      for (const items of Object.values(byCategory)) {
        for (const item of items || []) {
          if (item.in_pantry) pantry.push(item);
          else if (item.in_csa) csa.push(item);
          else if (item.best_store && isSupportedAustinStoreName(item.best_store)) {
            if (!stores[item.best_store]) stores[item.best_store] = [];
            stores[item.best_store].push(item);
          } else {
            other.push(item.best_store ? { ...item, best_store: null } : item);
          }
        }
      }
      byStore = { stores, other, pantry, csa };
    }
  } catch (err) {
    console.error('[/planner/export] lookup error:', err);
  }

  return res.render('planner-export', {
    title: 'Grocery list — Pantry',
    userId,
    planId,
    byCategory,
    byStore,
    hasPlan: planId != null,
    supportedAustinStoreNames: [...AUSTIN_RETAILER_DISPLAY_NAMES],
  });
});

router.get('/pantry', async (req, res) => {
  const userId = getUserIdFromCookie(req);

  let items = [];
  if (userId) {
    try {
      items = await pantryDb.getPantryItems(userId);
    } catch (err) {
      console.error('[/pantry] list error:', err);
    }
  }
  return res.render('pantry', { title: 'My Pantry — Pantry', userId, items });
});

module.exports = router;
