// "My Recipes" pool endpoint — returns bookmarked + imported recipes for a user.
// Does NOT own recipe generation — see services/meal-planner.js.
const express = require('express');
const router = express.Router();
const bookmarksDb = require('../db/user-bookmarks');
const recipesDb = require('../db/recipes');
const { rejectMismatchedUserId, requirePaidAccess, userIdMatchesAuthenticatedAccount } = require('../lib/pantry-access');

router.use(requirePaidAccess, rejectMismatchedUserId);
router.param('userId', (req, res, next, userId) => {
  if (!userIdMatchesAuthenticatedAccount(req, userId)) {
    return res.status(403).json({ error: 'userId does not match the authenticated account' });
  }
  return next();
});

// GET /api/my-recipes/:userId
// Returns: { bookmarked: [...], imported: [...], allRecipeIds: [...] }
router.get('/:userId', async (req, res) => {
  try {
    const userId = req.authenticatedUserId;

    const [bookmarked, imported] = await Promise.all([
      bookmarksDb.getUserBookmarks(userId),
      bookmarksDb.getUserImportedRecipes(userId),
    ]);

    const allRecipeIds = [
      ...new Set([
        ...bookmarked.map(b => b.recipe_id),
        ...imported.map(i => i.id),
      ])
    ];

    res.json({ bookmarked, imported, allRecipeIds });
  } catch (err) {
    console.error('[/api/my-recipes/:userId]', err);
    res.status(500).json({ error: 'Failed to fetch recipe pool' });
  }
});

module.exports = router;
