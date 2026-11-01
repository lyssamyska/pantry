// Meal planning algorithm. Takes user preferences → returns a 7-day plan + consolidated grocery list.
// Does NOT handle OpenAI calls — uses rule-based selection from the recipe DB.
// Smart dedup: combines identical ingredients across recipes into one line item.
const CATEGORY_ORDER = ['Produce', 'Meat & Seafood', 'Dairy & Eggs', 'Pantry', 'Frozen', 'Bakery', 'Other', 'In Pantry', 'From CSA Box'];
const { selectAustinPrice } = require('../lib/austin-retailers');
const UNICODE_FRACTIONS = {
  '½': '1/2',
  '¼': '1/4',
  '⅓': '1/3',
  '⅔': '2/3',
  '¾': '3/4'
};

function normalizeIngredientName(name) {
  return String(name || '').toLowerCase().trim()
    .replace(/\b(maybe|optional|small|medium|large)\b/g, '')
    .trim()
    .split(/\s+/)
    .map(word => ({ tomatoes: 'tomato', potatoes: 'potato', mangoes: 'mango' }[word]) || (word.endsWith('ies') && word.length > 4
      ? `${word.slice(0, -3)}y`
      : word.endsWith('s') && !/(ss|us|is)$/.test(word) && word.length > 3
        ? word.slice(0, -1)
        : word))
    .join(' ');
}

const UNIT_ALIASES = {
  cup: 'cup', cups: 'cup', c: 'cup', tablespoon: 'tbsp', tablespoons: 'tbsp', tbsp: 'tbsp', tbs: 'tbsp',
  teaspoon: 'tsp', teaspoons: 'tsp', tsp: 'tsp', ounce: 'oz', ounces: 'oz', oz: 'oz',
  pound: 'lb', pounds: 'lb', lbs: 'lb', lb: 'lb', gram: 'g', grams: 'g', g: 'g',
  kilogram: 'kg', kilograms: 'kg', kg: 'kg', milliliter: 'ml', milliliters: 'ml', ml: 'ml',
  liter: 'l', liters: 'l', l: 'l', 'fl oz': 'fl oz', 'fluid ounce': 'fl oz',
  'fluid ounces': 'fl oz', pint: 'pint', pints: 'pint', quart: 'quart', quarts: 'quart', gallon: 'gallon', gallons: 'gallon',
  each: 'each', piece: 'each', pieces: 'each', clove: 'clove', cloves: 'clove',
  bunch: 'bunch', bunches: 'bunch', can: 'can', cans: 'can', carton: 'carton', cartons: 'carton',
  slice: 'slice', slices: 'slice', sprig: 'sprig', sprigs: 'sprig', stalk: 'stalk', stalks: 'stalk',
  head: 'head', heads: 'head', jar: 'jar', jars: 'jar', bottle: 'bottle', bottles: 'bottle',
  package: 'package', packages: 'package', pack: 'pack', packs: 'pack', handful: 'handful', handfuls: 'handful'
};
const UNIT_DIMENSIONS = {
  cup: ['volume', 1], tbsp: ['volume', 1 / 16], tsp: ['volume', 1 / 48], pint: ['volume', 2], quart: ['volume', 4], gallon: ['volume', 16],
  'fl oz': ['volume', 1 / 8], ml: ['volume', 1 / 236.588], l: ['volume', 4.22675],
  oz: ['mass', 1], lb: ['mass', 16], g: ['mass', 1 / 28.3495], kg: ['mass', 35.274],
  each: ['count', 1], clove: ['count', 1], bunch: ['count', 1], can: ['count', 1], carton: ['count', 1],
  slice: ['count', 1], sprig: ['count', 1], stalk: ['count', 1], head: ['count', 1], jar: ['count', 1],
  bottle: ['count', 1], package: ['count', 1], pack: ['count', 1], handful: ['count', 1]
};

function normalizeUnit(unit) {
  const raw = String(unit || '').toLowerCase().trim().replace(/\./g, '').replace(/\s+/g, ' ');
  return UNIT_ALIASES[raw] || raw;
}

function convertAmount(amount, fromUnit, toUnit) {
  const from = normalizeUnit(fromUnit);
  const to = normalizeUnit(toUnit);
  if (from === to) return amount;
  const fromInfo = UNIT_DIMENSIONS[from];
  const toInfo = UNIT_DIMENSIONS[to];
  if (!fromInfo || !toInfo || fromInfo[0] !== toInfo[0]) return null;
  if (fromInfo[0] === 'count') return null;
  return amount * fromInfo[1] / toInfo[1];
}

function parseAmountPrefix(value) {
  const normalized = String(value || '').trim().replace(/[½¼⅓⅔¾]/g, fraction => ` ${UNICODE_FRACTIONS[fraction]}`).trim();
  const match = normalized.match(/^((?:\d+(?:\.\d+)?\s+)?\d+\s*\/\s*\d+|\d+(?:\.\d+)?|\.\d+)/);
  if (!match) return { amount: null, remainder: normalized };
  const amountText = match[0].trim().replace(/\s+/g, ' ');
  const parts = amountText.match(/^(\d+(?:\.\d+)?)\s+(\d+)\s*\/\s*(\d+)$/);
  let amount = Number(amountText);
  if (parts && Number(parts[3]) > 0) amount = Number(parts[1]) + Number(parts[2]) / Number(parts[3]);
  else if (amountText.includes('/')) {
    const [numerator, denominator] = amountText.split('/').map(Number);
    amount = denominator > 0 ? numerator / denominator : null;
  }
  return { amount: Number.isFinite(amount) ? amount : null, remainder: normalized.slice(match[0].length).trim() };
}

function extractLeadingUnit(value) {
  const words = String(value || '').trim().split(/\s+/);
  const twoWords = normalizeUnit(words.slice(0, 2).join(' '));
  if (words.length > 1 && UNIT_DIMENSIONS[twoWords]) return { unit: twoWords, remainder: words.slice(2).join(' ') };
  const oneWord = normalizeUnit(words[0]);
  if (UNIT_DIMENSIONS[oneWord]) return { unit: oneWord, remainder: words.slice(1).join(' ') };
  return { unit: '', remainder: value };
}

function parseRecipeIngredients(ingredients) {
  if (Array.isArray(ingredients)) return ingredients;
  if (typeof ingredients === 'string') {
    try {
      const parsed = JSON.parse(ingredients);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch (_) {
      return [ingredients];
    }
  }
  return ingredients === undefined || ingredients === null ? [] : [ingredients];
}

function getRecipeName(recipe) {
  return String(recipe && (recipe.name || recipe.meal) || 'Untitled recipe').trim() || 'Untitled recipe';
}

function sourceReferenceKey(reference) {
  if (typeof reference === 'string') return reference;
  return `${reference.recipe_name}\u0000${reference.ingredient_index}`;
}

function serializeRawIngredient(ingredient) {
  if (typeof ingredient === 'string') return ingredient;
  try {
    const serialized = JSON.stringify(ingredient);
    return serialized === undefined ? String(ingredient) : serialized;
  } catch (_) {
    return String(ingredient);
  }
}

function ingredientLabel(ingredient) {
  if (!ingredient || typeof ingredient !== 'object') return String(ingredient || '').trim();
  const labelFields = ['name', 'ingredient', 'text', 'value', 'description', 'label', 'title', 'ingredient_name', 'ingredientName'];
  for (const field of labelFields) {
    const value = ingredient[field];
    if (typeof value === 'string' || typeof value === 'number') {
      const label = String(value).trim();
      if (label) return label;
    }
  }
  return '';
}

function normalizeIngredient(ingredient, context = {}) {
  const isObject = ingredient && typeof ingredient === 'object';
  let name = ingredientLabel(ingredient);
  let rawQuantity = isObject ? (ingredient.quantity ?? ingredient.amount ?? '') : '';
  let unit = isObject ? normalizeUnit(ingredient.unit) : '';
  let reviewNote = null;
  let reviewOnly = false;

  const useReviewPlaceholder = () => {
    const recipeName = context.recipeName || 'Untitled recipe';
    const ingredientNumber = Number.isInteger(context.ingredientIndex) ? context.ingredientIndex + 1 : 1;
    name = `Review ingredient (${recipeName} #${ingredientNumber})`;
    reviewOnly = true;
    reviewNote = `Ingredient label could not be read; raw value: ${serializeRawIngredient(ingredient)}. Review before shopping.`;
  };

  if (!name) useReviewPlaceholder();

  if (!isObject) {
    const parsed = parseAmountPrefix(name);
    if (parsed.amount !== null) {
      rawQuantity = String(parsed.amount);
      const extracted = extractLeadingUnit(parsed.remainder);
      unit = extracted.unit || 'each';
      name = extracted.unit ? extracted.remainder : parsed.remainder;
    }
  }
  if (!String(name || '').trim()) useReviewPlaceholder();

  const parsedQuantity = parseAmountPrefix(rawQuantity);
  const amount = parsedQuantity.amount;
  if (amount !== null && !unit) {
    unit = extractLeadingUnit(parsedQuantity.remainder).unit || 'each';
  }
  const cleanName = String(name || '').trim();
  return {
    name: cleanName,
    amount,
    unit: unit || '',
    raw_quantity: String(rawQuantity || '').trim(),
    review_note: [reviewNote, amount === null ? 'Recipe quantity could not be read; review this ingredient.' : null].filter(Boolean).join(' ') || null,
    review_only: reviewOnly,
    sourcing_hint: isObject ? (ingredient.sourcing_hint || ingredient.sourcingHint || null) : null
  };
}

function formatAmount(amount) {
  return Number(amount.toFixed(3)).toString();
}

function formatUnit(unit, amount) {
  if (!unit || unit === 'each') return '';
  const abbreviations = ['oz', 'lb', 'g', 'kg', 'ml', 'l', 'tbsp', 'tsp', 'fl oz'];
  return abbreviations.includes(unit) ? unit : `${unit}${amount > 1.0001 ? 's' : ''}`;
}

function formatQuantity(amount, unit) {
  if (amount === null || amount === undefined) return '';
  const value = formatAmount(amount);
  const label = formatUnit(unit, amount);
  return label ? `${value} ${label}` : value;
}

function ingredientUnitKey(unit) {
  const normalized = normalizeUnit(unit);
  const info = UNIT_DIMENSIONS[normalized];
  return info && (info[0] === 'volume' || info[0] === 'mass') ? info[0] : `unit:${normalized}`;
}

function positiveServings(value, fallback = 2) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function priceInfoFromRow(row) {
  return {
    best_price: Number(row.price),
    best_store: row.store_name,
    logo_color: row.logo_color,
    package_quantity: row.package_quantity === null || row.package_quantity === undefined ? null : Number(row.package_quantity),
    package_unit: row.package_unit || null,
    package_label: row.package_label || row.unit || null,
    price_is_estimate: row.price_is_estimate !== false
  };
}

// Build a price lookup map from all ingredients (keyed by normalized name)
async function buildPriceMap(pricesDb) {
  const ingredients = await pricesDb.getAllIngredients();
  const map = {};
  for (const ing of ingredients) {
    const key = normalizeIngredientName(ing.name);
    const selected = selectAustinPrice([{
      price: ing.best_price,
      store_name: ing.best_store,
      store_slug: ing.best_store_slug,
      logo_color: ing.best_store_color,
      package_quantity: ing.best_package_quantity,
      package_unit: ing.best_package_unit,
      package_label: ing.best_package_label,
      price_is_estimate: ing.best_price_is_estimate
    }]);
    if (selected) {
      map[key] = priceInfoFromRow(selected);
    }
  }
  return map;
}

// Build per-ingredient price map (keyed by normalized name) from a flat
// (ingredient, store, price) join. Each ingredient contributes its single
// best price to its best store for day-level pricing.
async function getAllStorePricesByIngredient(pricesDb) {
  const rows = await pricesDb.getAllStorePrices();
  const rowsByIngredient = new Map();

  for (const row of rows) {
    const key = normalizeIngredientName(row.ingredient_name);
    if (!rowsByIngredient.has(key)) rowsByIngredient.set(key, []);
    rowsByIngredient.get(key).push(row);
  }

  const map = new Map();
  for (const [key, ingredientRows] of rowsByIngredient.entries()) {
    const selected = selectAustinPrice(ingredientRows);
    if (!selected) continue;
    map.set(key, {
      best_price: parseFloat(selected.price),
      best_store: selected.store_name,
      logo_color: selected.logo_color,
      package_quantity: selected.package_quantity === null || selected.package_quantity === undefined ? null : Number(selected.package_quantity),
      package_unit: selected.package_unit || null,
      package_label: selected.package_label || null,
      price_is_estimate: selected.price_is_estimate !== false
    });
  }

  return map;
}

function consolidateIngredients(recipes, servings = 2) {
  const itemMap = {};
  const targetServings = positiveServings(servings);

  for (const recipe of recipes) {
    const recipeName = getRecipeName(recipe);
    for (const [ingredientIndex, rawIngredient] of parseRecipeIngredients(recipe.ingredients).entries()) {
      const sourceRef = { recipe_name: recipeName, ingredient_index: ingredientIndex };
      const ing = normalizeIngredient(rawIngredient, { recipeName, ingredientIndex });
      const key = normalizeIngredientName(ing.name);
      const baseServings = positiveServings(recipe.base_servings, 4);
      if (ing.amount !== null) ing.amount *= targetServings / baseServings;
      const unitKey = ing.amount === null ? 'unquantified' : ingredientUnitKey(ing.unit);
      const groupKey = `${key}|${unitKey}${ing.review_only ? `|review:${sourceReferenceKey(sourceRef)}` : ''}`;
      if (!itemMap[groupKey]) {
        itemMap[groupKey] = {
          name: ing.name,
          amount: ing.amount,
          unit: ing.unit,
          quantity: ing.amount === null ? (ing.raw_quantity || 'Amount to review') : formatQuantity(ing.amount, ing.unit),
          recipes: [],
          sourcing_hint: ing.sourcing_hint || null,
          review_notes: [],
          review_only: ing.review_only,
          source_refs: []
        };
      } else if (ing.amount !== null) {
        const converted = convertAmount(ing.amount, ing.unit, itemMap[groupKey].unit);
        if (converted !== null) itemMap[groupKey].amount += converted;
      }
      const item = itemMap[groupKey];
      if (!item.recipes.includes(recipe.name)) item.recipes.push(recipe.name);
      if (ing.review_note && !item.review_notes.includes(ing.review_note)) item.review_notes.push(ing.review_note);
      if (!item.sourcing_hint && ing.sourcing_hint) item.sourcing_hint = ing.sourcing_hint;
      if (!item.source_refs.some(existing => sourceReferenceKey(existing) === sourceReferenceKey(sourceRef))) {
        item.source_refs.push(sourceRef);
      }
    }
  }

  for (const item of Object.values(itemMap)) {
    if (item.amount !== null) item.quantity = formatQuantity(item.amount, item.unit);
  }
  return itemMap;
}

function categorizeItem(name) {
  const n = name.toLowerCase();
  const produce = ['arugula', 'basil', 'bell pepper', 'bok choy', 'broccoli', 'carrot', 'celery', 'chard', 'cilantro', 'corn', 'cucumber', 'dill', 'eggplant', 'garlic', 'ginger', 'green bean', 'kale', 'leek', 'lemon', 'lettuce', 'lime', 'mint', 'mushroom', 'okra', 'onion', 'parsley', 'pea', 'pepper', 'potato', 'rosemary', 'sage', 'scallion', 'shallot', 'spinach', 'squash', 'thyme', 'tomato', 'zucchini'];
  const meat = ['beef', 'chicken', 'cod', 'crab', 'duck', 'fish', 'ground beef', 'ground turkey', 'ham', 'lamb', 'lobster', 'meatball', 'pork', 'salmon', 'sausage', 'scallop', 'shrimp', 'snapper', 'steak', 'tilapia', 'tofu', 'tomato', 'tonkatsu', 'tri-tip', 'trout', 'tuna', 'turkey', 'veal'];
  const dairy = ['butter', 'buttermilk', 'cheese', 'cottage', 'cream', 'cream cheese', 'egg', 'feta', 'goat cheese', 'gouda', 'gruyere', 'half-and-half', 'mascarpone', 'milk', 'mozzarella', 'parmesan', 'pecorino', 'provolone', 'ricotta', 'sour cream', 'swiss', 'whipping cream', 'yogurt'];
  const pantry = ['balsamic', 'bread crumb', 'broth', 'chickpea', 'coconut', 'flour', 'honey', 'ketchup', 'lentil', 'mayo', 'mustard', 'noodle', 'oil', 'pasta', 'peanut', 'rice', 'salad', 'salsa', 'soy sauce', 'stock', 'sugar', 'teriyaki', 'tomato paste', 'vinegar', 'wine'];
  const frozen = ['frozen', 'ice cream'];
  const bakery = ['bread', 'bun', 'pita', 'roll', 'tortilla'];

  if (/\b(broth|stock)\b/.test(n)) return 'Pantry';
  if (produce.some(p => n.includes(p))) return 'Produce';
  if (meat.some(m => n.includes(m))) return 'Meat & Seafood';
  if (dairy.some(d => n.includes(d))) return 'Dairy & Eggs';
  if (pantry.some(p => n.includes(p))) return 'Pantry';
  if (frozen.some(f => n.includes(f))) return 'Frozen';
  if (bakery.some(b => n.includes(b))) return 'Bakery';
  return 'Other';
}

async function buildGroceryList(recipes, pricesDb, pantryItems = [], csaItems = [], servings = 2) {
  const consolidated = consolidateIngredients(recipes, servings);
  const pantryStock = (pantryItems || []).filter(item => !item || item.source !== 'csa');
  const csaStock = csaItems || [];

  // Batch-fetch price data for all ingredients in one call
  const priceMap = await buildPriceMap(pricesDb);

  // Drift defense: ingredient-table names can drift from recipe names
  // (e.g. "filet" vs "fillet"); resolve any unfound key via the names table
  // so a price still shows instead of the em-dash fallback.
  const driftFallback = new Map();
  for (const item of Object.values(consolidated)) {
    const key = normalizeIngredientName(item.name);
    if (priceMap[key]) continue;
    const ingredient = await pricesDb.getIngredientByName(item.name);
    if (!ingredient) continue;
    const candidates = await pricesDb.getPricesByIngredient(ingredient.id);
    const best = selectAustinPrice(candidates);
    if (!best) continue;
    driftFallback.set(key, priceInfoFromRow(best));
  }

  const byCategory = {};

  for (const [_, item] of Object.entries(consolidated)) {
    const key = normalizeIngredientName(item.name);
    const coverage = calculateCoverage(item, pantryStock, csaStock);
    const trace = {
      name: item.name,
      quantity: item.quantity,
      required_quantity: item.quantity,
      unit: item.unit,
      from_recipes: [...new Set(item.recipes)],
      source_refs: item.source_refs,
      review_only: item.review_only,
      checked: false,
      sourcing_hint: item.sourcing_hint,
      review_note: [...item.review_notes, ...coverage.review_notes].filter(Boolean).join(' '),
      coverage_note: coverage.note || null,
      covered_quantity: coverage.covered_quantity || null
    };

    if (coverage.covered) {
      const category = coverage.in_pantry ? 'In Pantry' : 'From CSA Box';
      if (!byCategory[category]) byCategory[category] = [];
      byCategory[category].push({
        ...trace,
        in_pantry: coverage.in_pantry,
        in_csa: coverage.in_csa,
        coverage_source: coverage.source,
        best_price: null,
        line_total: null,
        best_store: null,
        logo_color: null,
        price_status: 'covered'
      });
      continue;
    }

    const buyItem = { ...item, amount: coverage.amount_to_buy };
    if (buyItem.amount !== null) buyItem.quantity = formatQuantity(buyItem.amount, buyItem.unit);
    const priceInfo = priceMap[key] || driftFallback.get(key) || null;
    const packagePurchase = getPackagePurchase(buyItem, priceInfo);
    const category = categorizeItem(item.name);
    if (!byCategory[category]) byCategory[category] = [];
    byCategory[category].push({
      ...trace,
      quantity: packagePurchase.purchase_quantity || buyItem.quantity,
      purchase_quantity: packagePurchase.purchase_quantity,
      required_quantity: item.quantity,
      buy_quantity: buyItem.quantity,
      best_price: packagePurchase.line_total === null ? null : priceInfo.best_price,
      line_total: packagePurchase.line_total,
      best_store: priceInfo ? priceInfo.best_store : null,
      logo_color: priceInfo ? priceInfo.logo_color : null,
      price_is_estimate: priceInfo ? priceInfo.price_is_estimate : null,
      package_count: packagePurchase.package_count,
      package_quantity: packagePurchase.package_quantity,
      package_unit: packagePurchase.package_unit,
      price_status: packagePurchase.line_total === null ? 'unavailable' : (priceInfo.price_is_estimate ? 'estimate' : 'available'),
      coverage_note: coverage.note || null,
      review_note: [...item.review_notes, ...coverage.review_notes].filter(Boolean).join(' ')
    });
  }

  const ordered = {};
  for (const cat of CATEGORY_ORDER) {
    if (byCategory[cat]) ordered[cat] = byCategory[cat].sort((a, b) => a.name.localeCompare(b.name));
  }
  for (const [cat, items] of Object.entries(byCategory)) {
    if (!CATEGORY_ORDER.includes(cat)) {
      ordered[cat] = items.sort((a, b) => a.name.localeCompare(b.name));
    }
  }

  return ordered;
}

function persistedGroceryItems(groceryPayload) {
  if (Array.isArray(groceryPayload)) {
    return groceryPayload.flatMap(row => Array.isArray(row && row.items) ? row.items : []);
  }
  if (!groceryPayload || typeof groceryPayload !== 'object') return [];
  return Object.values(groceryPayload).flatMap(items => Array.isArray(items) ? items : []);
}

function plannedIngredientReferences(recipes) {
  const recipeList = Array.isArray(recipes) ? recipes : (recipes && Array.isArray(recipes.days) ? recipes.days : []);
  return recipeList
    .filter(recipe => !Object.prototype.hasOwnProperty.call(recipe || {}, 'recipe_id') || recipe.recipe_id != null)
    .flatMap(recipe => parseRecipeIngredients(recipe && recipe.ingredients).map((_, ingredientIndex) => ({
      recipe_name: getRecipeName(recipe),
      ingredient_index: ingredientIndex
    })));
}

function isGroceryListComplete(groceryPayload, recipes) {
  const required = new Set(plannedIngredientReferences(recipes).map(sourceReferenceKey));
  if (required.size === 0) return true;
  const present = new Set(persistedGroceryItems(groceryPayload).flatMap(item => {
    if (!item || item.is_custom) return [];
    const refs = Array.isArray(item.source_refs) ? item.source_refs : [];
    return refs.map(sourceReferenceKey);
  }));
  return [...required].every(reference => present.has(reference));
}

function collectStock(stockItems, name, requiredUnit) {
  let amount = 0;
  let hasComparable = false;
  const reviewNotes = [];
  for (const stock of stockItems || []) {
    if (!stock || normalizeIngredientName(stock.name) !== name) continue;
    const parsed = parseAmountPrefix(stock.quantity);
    const stockUnit = normalizeUnit(stock.unit);
    if (parsed.amount === null || !stockUnit) {
      reviewNotes.push(`Listed ${stock.name} stock (${stock.quantity || 'quantity unknown'} ${stock.unit || ''}) cannot be compared to the recipe amount.`);
      continue;
    }
    const converted = convertAmount(parsed.amount, stockUnit, requiredUnit);
    if (converted === null) {
      reviewNotes.push(`Listed ${stock.name} stock in ${stock.unit} cannot be compared to the recipe's ${requiredUnit || 'unit'}.`);
      continue;
    }
    amount += converted;
    hasComparable = true;
  }
  return { amount, hasComparable, reviewNotes };
}

function calculateCoverage(item, pantryItems, csaItems) {
  const result = { covered: false, in_pantry: false, in_csa: false, source: null, note: '', covered_quantity: null, amount_to_buy: item.amount, review_notes: [] };
  if (item.amount === null) return result;
  const name = normalizeIngredientName(item.name);
  const pantry = collectStock(pantryItems, name, item.unit);
  const csa = collectStock(csaItems, name, item.unit);
  result.review_notes.push(...pantry.reviewNotes, ...csa.reviewNotes);
  const available = pantry.amount + csa.amount;
  if (available <= 0) return result;

  const pantryUsed = Math.min(pantry.amount, item.amount);
  const csaUsed = Math.min(csa.amount, Math.max(0, item.amount - pantryUsed));
  const covered = Math.min(item.amount, available);
  result.covered_quantity = formatQuantity(covered, item.unit);
  result.in_pantry = pantryUsed > 0;
  result.in_csa = csaUsed > 0;
  result.source = result.in_pantry && result.in_csa ? 'pantry and CSA' : result.in_pantry ? 'pantry' : 'CSA box';
  if (available + 0.000001 >= item.amount) {
    result.covered = true;
    result.amount_to_buy = 0;
    result.note = `Covered by ${result.source}${result.review_notes.length ? '; some listed stock needs review' : ''}.`;
  } else {
    result.amount_to_buy = Math.max(0, item.amount - available);
    result.note = `${formatQuantity(covered, item.unit)} covered by ${result.source}; buy ${formatQuantity(result.amount_to_buy, item.unit)}.`;
    result.review_notes.push(`Available pantry/CSA stock is insufficient; buy the listed shortfall.`);
  }
  return result;
}

function getPackagePurchase(item, priceInfo) {
  const unavailable = { line_total: null, purchase_quantity: null, package_count: null, package_quantity: null, package_unit: null };
  if (!priceInfo || !Number.isFinite(Number(priceInfo.best_price)) || item.amount === null || !priceInfo.package_quantity || !priceInfo.package_unit) return unavailable;
  const packageUnit = normalizeUnit(priceInfo.package_unit);
  const amountInPackageUnit = convertAmount(item.amount, item.unit, packageUnit);
  if (amountInPackageUnit === null || amountInPackageUnit <= 0) return unavailable;
  const packageCount = Math.max(1, Math.ceil((amountInPackageUnit - 0.000001) / Number(priceInfo.package_quantity)));
  const contents = packageCount * Number(priceInfo.package_quantity);
  const packageLabel = priceInfo.package_label || 'package';
  const contentUnit = formatUnit(packageUnit, contents) || packageUnit;
  return {
    line_total: Math.round((Number(priceInfo.best_price) * packageCount + Number.EPSILON) * 100) / 100,
    purchase_quantity: `${packageCount} ${packageLabel}${packageCount === 1 ? '' : 's'} (${formatAmount(contents)} ${contentUnit})`,
    package_count: packageCount,
    package_quantity: priceInfo.package_quantity,
    package_unit: packageUnit
  };
}

// Per-day pricing block, extracted so every meal_plans writer (generateMealPlan,
// addRecipeToDay, generateEmptyPlan) ends up with the same `pricing` shape on
// each day. Mirrors buildGroceryList's "purchase" semantics: ingredients already
// covered by the pantry or CSA box do not contribute to the day's store tally,
// and ingredients without compatible package data are reported as unpriced.
async function computeDayPricing(recipe, pricesDb, pantryItems = [], csaItems = [], servings = 2) {
  const ingredients = (recipe && recipe.ingredients) || [];
  if (ingredients.length === 0) {
    return { best_store: null, total_cost: 0, has_pricing: false, logo_color: null, unpriced_count: 0, price_is_estimate: false };
  }

  const priceMap = await getAllStorePricesByIngredient(pricesDb);
  const pantryStock = (pantryItems || []).filter(item => !item || item.source !== 'csa');
  const itemMap = consolidateIngredients([{ ...recipe, base_servings: recipe.base_servings || recipe.baseServings, ingredients }], servings);
  const storeTotals = {};
  let unpricedCount = 0;
  let hasEstimate = false;
  const storeColors = {};
  for (const item of Object.values(itemMap)) {
    const coverage = calculateCoverage(item, pantryStock, csaItems);
    if (coverage.covered) continue;
    const buyItem = { ...item, amount: coverage.amount_to_buy };
    const priceInfo = priceMap.get(normalizeIngredientName(item.name));
    const purchase = getPackagePurchase(buyItem, priceInfo);
    if (!priceInfo || !priceInfo.best_store || purchase.line_total === null) {
      unpricedCount++;
      continue;
    }
    storeTotals[priceInfo.best_store] = (storeTotals[priceInfo.best_store] || 0) + purchase.line_total;
    storeColors[priceInfo.best_store] = priceInfo.logo_color;
    if (priceInfo.price_is_estimate) hasEstimate = true;
  }

  const stores = Object.entries(storeTotals);
  if (stores.length === 0) {
    return { best_store: null, total_cost: 0, has_pricing: false, logo_color: null, unpriced_count: unpricedCount, price_is_estimate: false };
  }
  const totalCost = stores.reduce((sum, [, subtotal]) => sum + subtotal, 0);
  const onlyStore = stores.length === 1 ? stores[0][0] : null;
  return {
    best_store: unpricedCount === 0 ? onlyStore : null,
    total_cost: Math.round(totalCost * 100) / 100,
    has_pricing: true,
    logo_color: unpricedCount === 0 && onlyStore ? storeColors[onlyStore] : null,
    unpriced_count: unpricedCount,
    price_is_estimate: hasEstimate
  };
}

function getIngredientTokens(value) {
  return String(value || '').toLowerCase().match(/[a-z0-9]+/g) || [];
}

function recipeHasIngredientPhrase(recipe, phraseTokens) {
  return (recipe.ingredients || []).some(ingredient => {
    const ingredientTokens = getIngredientTokens(typeof ingredient === 'object' ? ingredient.name : ingredient);
    for (let start = 0; start <= ingredientTokens.length - phraseTokens.length; start++) {
      if (phraseTokens.every((token, index) => ingredientTokens[start + index] === token)) return true;
    }
    return false;
  });
}

function recipeMatchesRequiredPhrase(recipe, phrase) {
  const phraseTokens = getIngredientTokens(phrase);
  if (phraseTokens.length === 0) return false;
  const names = [recipe.name, ...(recipe.ingredients || []).map(ingredient =>
    typeof ingredient === 'object' ? ingredient.name : ingredient
  )];
  return names.some(name => {
    const nameTokens = getIngredientTokens(name);
    for (let start = 0; start <= nameTokens.length - phraseTokens.length; start++) {
      if (phraseTokens.every((token, index) => nameTokens[start + index] === token)) return true;
    }
    return false;
  });
}

function createRequiredIngredientError(message) {
  const error = new Error(message);
  error.code = 'UNSATISFIED_REQUIRED_INGREDIENT';
  return error;
}

async function generateMealPlan(options = {}, recipeDb, pricesDb) {
  const {
    dinnersNeeded = 7,
    servings = 2,
    mustHaveRecipes = [],
    mustHaveRecipeIds = [],
    mustHaveIngredients = [],
    avoidIngredients = [],
    excludeDietary = [],
    preferSourcingStandard = true,
    bookmarkedRecipeIds = [],
    pantryItems = [],
    csaItems = []
  } = options;

  // Get all recipes (wider pool for must-have matching)
  let pool = await recipeDb.getRecipesForMealPlan({ maxPrepTime: 120 });
  const dietaryRequirements = (Array.isArray(excludeDietary) ? excludeDietary : [excludeDietary])
    .map(flag => String(flag || '').trim())
    .filter(Boolean);
  pool = (pool || []).filter(recipe => dietaryRequirements.every(flag =>
    (recipe.dietary_flags || []).includes(flag)
  ));
  const avoidedIngredientTerms = (Array.isArray(avoidIngredients) ? avoidIngredients : [avoidIngredients])
    .flatMap(term => String(term || '').split(','))
    .map(term => term.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
  const avoidedIngredientPhrases = avoidedIngredientTerms
    .map(term => getIngredientTokens(term))
    .filter(phraseTokens => phraseTokens.length > 0);
  pool = (pool || []).filter(recipe => !avoidedIngredientPhrases.some(phraseTokens =>
    recipeHasIngredientPhrase(recipe, phraseTokens)
  ));
  if (pool.length === 0) {
    throw new Error('No recipes available — seed-recipes did not populate the recipes table');
  }

  // Boost bookmarked recipes — sort bookmarked to front, then sourcing, then random
  if (bookmarkedRecipeIds.length > 0) {
    pool = [...pool].sort((a, b) => {
      const aBooked = bookmarkedRecipeIds.includes(a.id);
      const bBooked = bookmarkedRecipeIds.includes(b.id);
      if (aBooked && !bBooked) return -1;
      if (!aBooked && bBooked) return 1;
      if (preferSourcingStandard) {
        if (a.sourcing_standard !== b.sourcing_standard) return b.sourcing_standard ? 1 : -1;
      }
      return Math.random() - 0.5;
    });
  }

  const plan = [];
  const usedRecipeIds = new Set();

  // 1. Force-include by recipe IDs (from My Recipes selection)
  if (mustHaveRecipeIds.length > 0) {
    for (const id of mustHaveRecipeIds) {
      if (plan.length >= dinnersNeeded) break;
      const match = pool.find(r => r.id === id && !usedRecipeIds.has(r.id));
      if (match) {
        plan.push(match);
        usedRecipeIds.add(match.id);
      }
    }
  }

  // 2. Must-have recipes by full-phrase text search
  if (mustHaveRecipes.length > 0) {
    for (const term of mustHaveRecipes) {
      if (plan.some(recipe => recipeMatchesRequiredPhrase(recipe, term))) continue;
      if (plan.length >= dinnersNeeded) {
        throw createRequiredIngredientError(`No dinner slot is available for the required meal "${term}".`);
      }
      const match = pool.find(r => !usedRecipeIds.has(r.id) && recipeMatchesRequiredPhrase(r, term));
      if (!match) throw createRequiredIngredientError(`No available recipe matches the required meal "${term}".`);
      plan.push(match);
      usedRecipeIds.add(match.id);
    }
  }

  // 3. Must-have ingredients — match the complete phrase atomically.
  const requiredIngredientTerms = (Array.isArray(mustHaveIngredients) ? mustHaveIngredients : [mustHaveIngredients])
    .flatMap(term => String(term || '').split(','))
    .map(term => term.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
  for (const term of requiredIngredientTerms) {
    const termTokens = getIngredientTokens(term);
    if (termTokens.length === 0) continue;

    const matchingRecipes = pool.filter(recipe => recipeMatchesRequiredPhrase(recipe, term));
    if (matchingRecipes.length === 0) {
      throw createRequiredIngredientError(`No available recipe includes the required ingredient phrase "${term}".`);
    }

    const alreadyPlanned = plan.some(recipe => recipeMatchesRequiredPhrase(recipe, term));
    if (alreadyPlanned) continue;

    if (plan.length >= dinnersNeeded) {
      throw createRequiredIngredientError(`No dinner slot is available for the required ingredient phrase "${term}".`);
    }

    const match = matchingRecipes.find(recipe => !usedRecipeIds.has(recipe.id));
    if (!match) {
      throw createRequiredIngredientError(`No available dinner can satisfy the required ingredient phrase "${term}".`);
    }
    plan.push(match);
    usedRecipeIds.add(match.id);
  }

  // Add more from pool if needed (prefer sourcing standard)
  if (plan.length < dinnersNeeded) {
    const remaining = pool.filter(r => !usedRecipeIds.has(r.id));

    // Sort: sourcing_standard first, then random
    const sorted = [...remaining].sort((a, b) => {
      if (preferSourcingStandard) {
        if (a.sourcing_standard !== b.sourcing_standard) return b.sourcing_standard ? 1 : -1;
      }
      return Math.random() - 0.5;
    });

    const needed = dinnersNeeded - plan.length;
    for (let i = 0; i < Math.min(needed, sorted.length); i++) {
      plan.push(sorted[i]);
      usedRecipeIds.add(sorted[i].id);
    }
  }

  const selectedPlan = plan.slice(0, dinnersNeeded);

  // Build grocery list
  const selectedServings = positiveServings(servings);
  const groceryList = await buildGroceryList(selectedPlan, pricesDb, pantryItems, csaItems, selectedServings);

  // Build 7-day plan (some days may be "leftover" / skip).
  // Per-day best-store + cost are populated by computeDayPricing below so
  // every writer that calls it produces the same shape.
  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const planDays = await Promise.all(selectedPlan.map(async (recipe, i) => {
    const day = {
      day: DAYS[i],
      recipe_id: recipe.id,
      meal: recipe.name,
      base_servings: positiveServings(recipe.base_servings, 4),
      description: recipe.description,
      prep_time: recipe.prep_time_minutes,
      protein_type: recipe.protein_type,
      ingredients: recipe.ingredients,
      instructions: recipe.instructions || [],
      tags: recipe.tags || []
    };
    day.pricing = await computeDayPricing(recipe, pricesDb, pantryItems, csaItems, selectedServings);
    return day;
  }));

  return {
    days: planDays,
    grocery_list: groceryList,
    servings: selectedServings,
    stats: {
      total_recipes: selectedPlan.length,
      avg_prep_time: selectedPlan.length > 0 ? Math.round(selectedPlan.reduce((sum, r) => sum + r.prep_time_minutes, 0) / selectedPlan.length) : 0,
      sourcing_compliant: selectedPlan.filter(r => r.sourcing_standard).length
    }
  };
}

module.exports = { generateMealPlan, buildGroceryList, consolidateIngredients, computeDayPricing, isGroceryListComplete };
