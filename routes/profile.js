const express = require('express');
const { getUserById, saveOnboardingPreferences } = require('../db/users');
const { getUserIdFromCookie } = require('../lib/user-session');
const { getPaymentPresentation } = require('../lib/pantry-payments');
const { getConfiguredPaidAccess } = require('../lib/pantry-access');

const router = express.Router();
const DIETARY_CHOICES = new Set(['vegetarian', 'vegan', 'gluten-free', 'dairy-free', 'paleo', 'keto']);
const MEAL_COUNT_KEYS = ['dinners', 'lunches', 'breakfasts', 'snacks'];

router.get('/', async (req, res, next) => {
  const userId = getUserIdFromCookie(req);
  if (!userId) return res.redirect('/?account=1');

  try {
    const user = await getUserById(userId);
    if (!user) {
      res.clearCookie('user_id', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
      });
      return res.redirect('/?account=1');
    }

    const paidAccess = await getConfiguredPaidAccess(userId);
    res.render('profile', {
      title: 'Your Profile — Pantry',
      user,
      paymentPresentation: { ...getPaymentPresentation(user), hasPaidAccess: paidAccess.hasAccess },
      dietPreferences: Array.isArray(user.diet_preferences) ? user.diet_preferences : [],
      mealCountDefaults: user.meal_count_defaults && typeof user.meal_count_defaults === 'object'
        ? user.meal_count_defaults
        : {},
    });
  } catch (err) {
    next(err);
  }
});

router.put('/preferences', async (req, res) => {
  const userId = getUserIdFromCookie(req);
  if (!userId) return res.status(401).json({ success: false, message: 'Not authenticated' });

  const { dietPreferences, mealCountDefaults } = req.body || {};
  if (!Array.isArray(dietPreferences) || dietPreferences.some((choice) => !DIETARY_CHOICES.has(choice)) ||
      new Set(dietPreferences).size !== dietPreferences.length) {
    return res.status(400).json({ success: false, message: 'Choose valid dietary preferences.' });
  }
  if (!mealCountDefaults || typeof mealCountDefaults !== 'object' || Array.isArray(mealCountDefaults) ||
      !MEAL_COUNT_KEYS.every((key) => Number.isInteger(mealCountDefaults[key]) && mealCountDefaults[key] >= 0 && mealCountDefaults[key] <= 7)) {
    return res.status(400).json({ success: false, message: 'Meal counts must be whole numbers from 0 to 7.' });
  }

  try {
    const preferences = MEAL_COUNT_KEYS.reduce((result, key) => {
      result[key] = mealCountDefaults[key];
      return result;
    }, {});
    await saveOnboardingPreferences(userId, dietPreferences, preferences);
    res.json({ success: true });
  } catch (err) {
    console.error('[profile/preferences]', err);
    res.status(500).json({ success: false, message: 'Failed to save profile preferences.' });
  }
});

module.exports = router;
