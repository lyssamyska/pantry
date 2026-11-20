// "Discover Recipes" endpoint — surfaces bookmarked, imported, and curated
// recipes the user has not yet tried. Does NOT own meal plan generation.
const express = require('express');
const router = express.Router();
const recipesDb = require('../db/recipes');
const { rejectMismatchedUserId, requireAuth, userIdMatchesAuthenticatedAccount } = require('../lib/require-auth');

router.use(requireAuth, rejectMismatchedUserId);
router.param('userId', (req, res, next, userId) => {
  if (!userIdMatchesAuthenticatedAccount(req, userId)) {
    return res.status(403).json({ error: 'userId does not match the authenticated account' });
  }
  return next();
});

// GET /api/discovery/:userId
// Returns: { bookmarked: [...], imported: [...], curated: [...], recipes: [...] }
// `recipes` is a flat array view; the bucketed shape is what the panel renders.
// The path account ID must match the authenticated cookie account.
router.get('/:userId', async (req, res) => {
  try {
    const userId = req.authenticatedUserId;
    const buckets = await recipesDb.getDiscoveryRecipes(userId, 12);
    const recipes = [...buckets.bookmarked, ...buckets.imported, ...buckets.curated];

    res.json({ ...buckets, recipes });
  } catch (err) {
    console.error('[/api/discovery/:userId]', err);
    res.status(500).json({ error: 'Failed to fetch discovery recipes' });
  }
});

module.exports = router;
