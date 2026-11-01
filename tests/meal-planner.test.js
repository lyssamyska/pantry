const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildGroceryList,
  isGroceryListComplete
} = require('../services/meal-planner');

const pricesDb = {
  async getAllIngredients() {
    return [];
  },
  async getIngredientByName() {
    return null;
  },
  async getPricesByIngredient() {
    return [];
  }
};

function groceryItems(groceryList) {
  return Object.values(groceryList).flat();
}

function sourceKeys(items) {
  return new Set(items.flatMap(item => item.source_refs || [])
    .map(reference => `${reference.recipe_name}:${reference.ingredient_index}`));
}

test('buildGroceryList accounts for every ingredient representation and preserves duplicate source refs', async () => {
  const recipes = [{
    name: 'Mixed Labels',
    base_servings: 2,
    ingredients: JSON.stringify([
      '1 cup rice',
      { name: 'beans', quantity: '1 can' },
      { ingredient: 'salsa', quantity: '2 tbsp' },
      { text: 'lime', quantity: '1' },
      { value: 'cilantro', quantity: '1 tbsp' },
      { description: 'garlic', quantity: '2 cloves' },
      { metadata: 'needs review', quantity: '1 each' },
      { text: 'rice', quantity: '1 cup' }
    ])
  }];

  const groceryList = await buildGroceryList(recipes, pricesDb, [], [], 2);
  const items = groceryItems(groceryList);
  const refs = sourceKeys(items);

  assert.equal(refs.size, 8);
  for (let ingredientIndex = 0; ingredientIndex < 8; ingredientIndex++) {
    assert.ok(refs.has(`Mixed Labels:${ingredientIndex}`));
  }

  const rice = items.find(item => item.name === 'rice');
  assert.deepEqual(rice.source_refs, [
    { recipe_name: 'Mixed Labels', ingredient_index: 0 },
    { recipe_name: 'Mixed Labels', ingredient_index: 7 }
  ]);

  const reviewItem = items.find(item => item.review_only);
  assert.match(reviewItem.name, /Review ingredient \(Mixed Labels #7\)/);
  assert.match(reviewItem.review_note, /needs review/);
  assert.equal(isGroceryListComplete(groceryList, recipes), true);
});

test('buildGroceryList leaves pantry shortfalls for purchase and marks full pantry or CSA coverage', async () => {
  const recipe = {
    name: 'Covered Meal',
    base_servings: 2,
    ingredients: [{ name: 'carrot', quantity: '2 each' }]
  };

  const partial = await buildGroceryList(
    [recipe],
    pricesDb,
    [{ name: 'carrot', quantity: '1', unit: 'each' }],
    [],
    2
  );
  const partialItem = partial.Produce[0];
  assert.equal(partialItem.buy_quantity, '1');
  assert.equal(partialItem.price_status, 'unavailable');
  assert.deepEqual(partialItem.source_refs, [{ recipe_name: 'Covered Meal', ingredient_index: 0 }]);

  const pantryCovered = await buildGroceryList(
    [recipe],
    pricesDb,
    [{ name: 'carrot', quantity: '2', unit: 'each' }],
    [],
    2
  );
  assert.equal(pantryCovered['In Pantry'][0].price_status, 'covered');
  assert.deepEqual(pantryCovered['In Pantry'][0].source_refs, [{ recipe_name: 'Covered Meal', ingredient_index: 0 }]);

  const csaCovered = await buildGroceryList(
    [recipe],
    pricesDb,
    [],
    [{ name: 'carrot', quantity: '2', unit: 'each' }],
    2
  );
  assert.equal(csaCovered['From CSA Box'][0].price_status, 'covered');
  assert.deepEqual(csaCovered['From CSA Box'][0].source_refs, [{ recipe_name: 'Covered Meal', ingredient_index: 0 }]);
});

test('isGroceryListComplete detects a missing persisted source reference', async () => {
  const recipes = [{
    name: 'Completeness Meal',
    ingredients: ['1 onion', '2 cloves garlic']
  }];
  const groceryList = await buildGroceryList(recipes, pricesDb, [], [], 2);
  assert.equal(isGroceryListComplete(groceryList, recipes), true);

  const missingOne = Object.fromEntries(Object.entries(groceryList).map(([category, items]) => [
    category,
    items.map((item, index) => index === 0
      ? { ...item, source_refs: [] }
      : { ...item })
  ]));
  assert.equal(isGroceryListComplete(missingOne, recipes), false);
});
