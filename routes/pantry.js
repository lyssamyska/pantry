// Pantry endpoints. Does NOT own meal plan generation — see services/meal-planner.js.
const express = require('express');
const router = express.Router();
const pantryDb = require('../db/pantry-items');
const { rejectMismatchedUserId, requirePaidAccess, userIdMatchesAuthenticatedAccount } = require('../lib/pantry-access');

router.use(requirePaidAccess, rejectMismatchedUserId);
router.param('userId', (req, res, next, userId) => {
  if (!userIdMatchesAuthenticatedAccount(req, userId)) {
    return res.status(403).json({ error: 'userId does not match the authenticated account' });
  }
  return next();
});

// POST /api/pantry
// Body: { userId, name, quantity, unit, expires_at?, source? }
// source ∈ ['pantry', 'csa'] — defaults to 'pantry'. Anything else → 400.
// Returns: 201 { item }
router.post('/', async (req, res) => {
  try {
    const { name, quantity, unit, expires_at, source } = req.body || {};
    const userId = req.authenticatedUserId;
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' });
    if (!quantity || !String(quantity).trim()) return res.status(400).json({ error: 'quantity is required' });
    if (!unit || !String(unit).trim()) return res.status(400).json({ error: 'unit is required' });

    const finalSource = source == null ? 'pantry' : String(source);
    if (!pantryDb.ALLOWED_SOURCES.includes(finalSource)) {
      return res.status(400).json({ error: `source must be one of ${pantryDb.ALLOWED_SOURCES.join(', ')}` });
    }

    const item = await pantryDb.addPantryItem(userId, {
      name: String(name).trim(),
      quantity: String(quantity).trim(),
      unit: String(unit).trim(),
      expires_at,
      source: finalSource
    });
    res.status(201).json({ item });
  } catch (err) {
    console.error('[/api/pantry]', err);
    res.status(500).json({ error: 'Failed to add pantry item' });
  }
});

// GET /api/pantry?userId=<id>
// Returns: { items: [...] }
router.get('/', async (req, res) => {
  try {
    const userId = req.authenticatedUserId;
    const items = await pantryDb.getPantryItems(userId);
    res.json({ items });
  } catch (err) {
    console.error('[/api/pantry]', err);
    res.status(500).json({ error: 'Failed to fetch pantry items' });
  }
});

// GET /api/pantry/:userId
// Returns: { items: [...] }
router.get('/:userId', async (req, res) => {
  try {
    const userId = req.authenticatedUserId;

    const items = await pantryDb.getPantryItems(userId);
    res.json({ items });
  } catch (err) {
    console.error('[/api/pantry/:userId]', err);
    res.status(500).json({ error: 'Failed to fetch pantry items' });
  }
});

// GET /api/pantry/:userId/csa
// Returns: { items: [...] } — only items with source = 'csa'
router.get('/:userId/csa', async (req, res) => {
  try {
    const userId = req.authenticatedUserId;

    const items = await pantryDb.getCsaItems(userId);
    res.json({ items });
  } catch (err) {
    console.error('[/api/pantry/:userId/csa]', err);
    res.status(500).json({ error: 'Failed to fetch CSA items' });
  }
});

// PATCH /api/pantry/:itemId
// Body: { userId, name, quantity, unit }
// Returns: 200 { item } | 404 { error: 'Item not found' }
router.patch('/:itemId', async (req, res) => {
  try {
    const itemIdValue = String(req.params.itemId || '');
    const itemId = Number(itemIdValue);
    const userId = req.authenticatedUserId;
    if (!/^\d+$/.test(itemIdValue) || !Number.isInteger(itemId) || itemId <= 0) {
      return res.status(400).json({ error: 'Invalid itemId' });
    }
    const { name, quantity, unit } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' });
    if (!quantity || !String(quantity).trim()) return res.status(400).json({ error: 'quantity is required' });
    if (!unit || !String(unit).trim()) return res.status(400).json({ error: 'unit is required' });

    const item = await pantryDb.updatePantryItem(userId, itemId, {
      name: String(name).trim(),
      quantity: String(quantity).trim(),
      unit: String(unit).trim()
    });
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json({ item });
  } catch (err) {
    console.error('[/api/pantry/:itemId]', err);
    res.status(500).json({ error: 'Failed to update pantry item' });
  }
});

// DELETE /api/pantry/:itemId?userId=...
// Returns: 200 { ok: true } | 404 { error: 'Item not found' }
router.delete('/:itemId', async (req, res) => {
  try {
    const itemIdValue = String(req.params.itemId || '');
    const itemId = Number(itemIdValue);
    const userId = req.authenticatedUserId;
    if (!/^\d+$/.test(itemIdValue) || !Number.isInteger(itemId) || itemId <= 0) {
      return res.status(400).json({ error: 'Invalid itemId' });
    }
    const deleted = await pantryDb.deletePantryItem(userId, itemId);
    if (!deleted) return res.status(404).json({ error: 'Item not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[/api/pantry/:itemId]', err);
    res.status(500).json({ error: 'Failed to delete pantry item' });
  }
});

module.exports = router;
