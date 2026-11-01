// Price comparison API routes.
const express = require('express');
const router = express.Router();
const pricesDb = require('../db/prices');
const {
  SUPPORTED_AUSTIN_RETAILER_SLUGS,
  isSupportedAustinStoreSlug,
  selectAustinPrice
} = require('../lib/austin-retailers');

const supportedStoreSlugs = [...SUPPORTED_AUSTIN_RETAILER_SLUGS];

// GET /api/prices/compare/:ingredientId
// Returns all supported price entries for one ingredient, with H-E-B first.
router.get('/compare/:ingredientId', async (req, res) => {
  try {
    const id = parseInt(req.params.ingredientId);
    if (!id) return res.status(400).json({ error: 'Invalid ingredientId' });

    const prices = (await pricesDb.getPricesByIngredient(id))
      .filter(price => isSupportedAustinStoreSlug(price.store_slug));
    if (!prices.length) return res.status(404).json({ error: 'Ingredient not found' });

    const ingredient = { id: prices[0].ingredient_id, name: prices[0].ingredient_name };
    res.json({
      ingredient,
      prices: prices.map(p => ({
        store: p.store_name,
        store_slug: p.store_slug,
        logo_color: p.logo_color,
        price: parseFloat(p.price),
        unit: p.unit,
        deal: p.deal,
        deal_description: p.deal_description
      }))
    });
  } catch (err) {
    console.error('[/api/prices/compare/:ingredientId]', err);
    res.status(500).json({ error: 'Failed to fetch prices' });
  }
});

// GET /api/prices/store/:storeId
// Returns all price entries for a store with ingredient details.
router.get('/store/:storeId', async (req, res) => {
  try {
    const id = parseInt(req.params.storeId);
    if (!id) return res.status(400).json({ error: 'Invalid storeId' });

    const prices = await pricesDb.getPricesByStore(id);
    res.json({ store_id: id, prices });
  } catch (err) {
    console.error('[/api/prices/store/:storeId]', err);
    res.status(500).json({ error: 'Failed to fetch store prices' });
  }
});

// GET /api/prices/best-deal
// Returns the top 5 deal items across all stores.
router.get('/best-deal', async (req, res) => {
  try {
    const result = await pricesDb.pool.query(`
      SELECT pe.*, s.name as store_name, s.slug as store_slug, s.logo_color,
             i.name as ingredient_name, i.category
      FROM price_entries pe
      JOIN stores s ON pe.store_id = s.id
      JOIN ingredients i ON pe.ingredient_id = i.id
      WHERE pe.deal = true AND s.slug = ANY($1)
      ORDER BY CASE WHEN s.slug = 'heb' THEN 0 ELSE 1 END,
               pe.price ASC, s.slug ASC, s.name ASC
      LIMIT 5
    `, [supportedStoreSlugs]);
    const deals = result.rows.map(p => ({
      ingredient: p.ingredient_name,
      category: p.category,
      store: p.store_name,
      store_slug: p.store_slug,
      logo_color: p.logo_color,
      price: parseFloat(p.price),
      unit: p.unit,
      deal_description: p.deal_description
    }));
    res.json({ deals });
  } catch (err) {
    console.error('[/api/prices/best-deal]', err);
    res.status(500).json({ error: 'Failed to fetch deals' });
  }
});

// POST /api/prices/lookup
// Batch lookup for multiple ingredients.
// Body: { items: [{name, category}] }
// Returns: [{name, best_price, best_store, logo_color, all_prices}]
router.post('/lookup', async (req, res) => {
  try {
    const { items } = req.body || {};
    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ error: 'items array is required' });
    }

    const results = await Promise.all(items.map(async (item) => {
      // Try exact match first (normalized), then fallback by category search
      const ing = await pricesDb.getIngredientByName(item.name);
      if (!ing) {
        return { name: item.name, found: false };
      }

      const prices = (await pricesDb.getPricesByIngredient(ing.id))
        .filter(price => isSupportedAustinStoreSlug(price.store_slug));
      const selected = selectAustinPrice(prices);
      if (!selected) {
        return { name: item.name, ingredient_id: ing.id, found: true, has_prices: false };
      }

      return {
        name: item.name,
        ingredient_id: ing.id,
        found: true,
        has_prices: true,
        best_price: parseFloat(selected.price),
        best_store: selected.store_name,
        logo_color: selected.logo_color,
        all_prices: prices.map(p => ({
          store: p.store_name,
          store_slug: p.store_slug,
          price: parseFloat(p.price),
          unit: p.unit,
          deal: p.deal,
          deal_description: p.deal_description
        }))
      };
    }));

    res.json({ results });
  } catch (err) {
    console.error('[/api/prices/lookup]', err);
    res.status(500).json({ error: 'Failed to lookup prices' });
  }
});

module.exports = router;
