const express = require('express');
const router = express.Router();
const { saveOnboardingPreferences } = require('../db/users');
const { getUserIdFromCookie } = require('../lib/user-session');

// POST /api/onboarding/complete
router.post('/complete', async (req, res) => {
  const userId = getUserIdFromCookie(req);
  if (!userId) return res.status(401).json({ success: false, message: 'Not authenticated' });

  const { dietPreferences = [], mealCountDefaults = {} } = req.body;
  try {
    await saveOnboardingPreferences(userId, dietPreferences, mealCountDefaults);
    res.json({ success: true });
  } catch (err) {
    console.error('[onboarding/complete]', err);
    res.status(500).json({ success: false, message: 'Failed to save preferences' });
  }
});

module.exports = router;
