// Bookmark toggle and list endpoints. Does NOT own meal plan generation — see services/meal-planner.js.
const express = require('express');
const router = express.Router();
const bookmarksDb = require('../db/user-bookmarks');
const { rejectMismatchedUserId, requireAuth, userIdMatchesAuthenticatedAccount } = require('../lib/require-auth');

router.use(requireAuth, rejectMismatchedUserId);
router.param('userId', (req, res, next, userId) => {
  if (!userIdMatchesAuthenticatedAccount(req, userId)) {
    return res.status(403).json({ error: 'userId does not match the authenticated account' });
  }
  return next();
});

// POST /api/bookmarks/toggle
// Body: { userId: number, recipeId: number }
// Returns: { bookmarked: boolean }
router.post('/toggle', async (req, res) => {
  try {
    const { recipeId } = req.body || {};
    const userId = req.authenticatedUserId;
    if (!recipeId) return res.status(400).json({ error: 'recipeId is required' });

    const exists = await bookmarksDb.isBookmarked(userId, recipeId);
    if (exists) {
      await bookmarksDb.removeBookmark(userId, recipeId);
      res.json({ bookmarked: false });
    } else {
      await bookmarksDb.addBookmark(userId, recipeId);
      res.json({ bookmarked: true });
    }
  } catch (err) {
    console.error('[/api/bookmarks/toggle]', err);
    res.status(500).json({ error: 'Failed to toggle bookmark' });
  }
});

// GET /api/bookmarks/:userId
// Returns all bookmarks for a user.
router.get('/:userId', async (req, res) => {
  try {
    const userId = req.authenticatedUserId;

    const bookmarks = await bookmarksDb.getUserBookmarks(userId);
    res.json({ bookmarks });
  } catch (err) {
    console.error('[/api/bookmarks/:userId]', err);
    res.status(500).json({ error: 'Failed to fetch bookmarks' });
  }
});

// GET /api/bookmarks/:userId/check?recipeIds=1,2,3
// Returns which of the given recipe IDs are bookmarked.
router.get('/:userId/check', async (req, res) => {
  try {
    const userId = req.authenticatedUserId;
    const ids = (req.query.recipeIds || '').split(',').map(s => parseInt(s.trim())).filter(Boolean);
    if (ids.length === 0) return res.status(400).json({ error: 'Invalid params' });

    const bookmarkedIds = await bookmarksDb.getBookmarkedRecipeIds(userId);
    const checked = ids.map(id => ({ recipeId: id, bookmarked: bookmarkedIds.includes(id) }));
    res.json({ results: checked });
  } catch (err) {
    console.error('[/api/bookmarks/:userId/check]', err);
    res.status(500).json({ error: 'Failed to check bookmarks' });
  }
});

module.exports = router;
