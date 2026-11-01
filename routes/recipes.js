// Recipe detail and listing endpoints. Does NOT own meal plan generation — see services/meal-planner.js.
const express = require('express');
const router = express.Router();
const recipesDb = require('../db/recipes');

// GET /api/recipes/:id
// Returns full recipe (ingredients + instructions) by ID.
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid recipe id' });

    const recipe = await recipesDb.getRecipeById(id);
    if (!recipe) return res.status(404).json({ error: 'Recipe not found' });

    res.json({ recipe });
  } catch (err) {
    console.error('[/api/recipes/:id]', err);
    res.status(500).json({ error: 'Failed to fetch recipe' });
  }
});

module.exports = router;