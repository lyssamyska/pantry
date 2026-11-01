const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  checkCompliance,
  auditRecipe,
  deriveDietaryFlags,
  reconcileDietaryFlags,
  detectProtein,
  PROTEIN_RULES,
} = require('../services/compliance');
const { getSeedRecipes, getOriginalSeedRecipes } = require('../lib/seed-recipes');

const ok = (line) => checkCompliance([line]).compliant;
const types = (line) => checkCompliance([line]).issues.map((i) => i.type);

test('flags real gluten and sugar sources', () => {
  for (const line of ['1 cup all-purpose flour', '2 tbsp soy sauce', '12 oz spaghetti', '4 pita', 'panko breadcrumbs',
    '1 cup farro', '8 oz soba noodles', '3 tbsp oyster sauce', 'flour tortillas', '1 bottle beer', 'egg noodles']) {
    assert.deepEqual(types(line), ['gluten'], line);
  }
  for (const line of ['3 tbsp brown sugar', '2 tbsp honey', 'maple syrup', '1 cup ketchup', '2 tbsp mirin', 'agave nectar']) {
    assert.deepEqual(types(line), ['sugar'], line);
  }
  assert.deepEqual(types('3 tbsp hoisin sauce').sort(), ['gluten', 'sugar']);
});

test('never flags "<x>-free" or "no <x>" (false positives)', () => {
  for (const line of [
    'sugar-free ketchup',
    'gluten-free flour',
    '1 cup gluten free flour',
    'gluten-free panko',
    'gluten-free soy sauce',
    'gluten-free spaghetti',
    'gluten-free oyster sauce',
    'no sugar added BBQ sauce',
    'no-sugar-added ketchup',
    'ketchup, no added sugar',
    'sugar free maple syrup',
    'no gluten crackers',
    'honey-free granola',
    'wheat-free tamari',
    'unsweetened ketchup',
  ]) {
    assert.equal(ok(line), true, line);
  }
});

test('coconut aminos, Siete products, and cauliflower rice are compliant', () => {
  for (const line of ['3 tbsp coconut aminos', 'Siete almond flour tortillas', 'Siete grain free tortilla chips',
    'Siete cassava flour tortillas', '2 cups cauliflower rice', '12 oz riced cauliflower']) {
    assert.equal(ok(line), true, line);
  }
});

test('whole-word matching avoids look-alike false positives', () => {
  for (const line of ['buckwheat groats', 'sugar snap peas', 'honeydew melon', '8 oz rice noodles', 'corn tortillas',
    'zucchini noodles', 'almond flour', 'cassava flour', 'spaghetti squash', 'rice paper wrappers', '2 tbsp cornstarch',
    'stevia', 'monk fruit sweetener', 'fish sauce', 'beef broth', 'chicken stock', 'pastured chicken thighs']) {
    assert.equal(ok(line), true, line);
  }
});

test('reports a line once per category, with every matched term', () => {
  const { issues } = checkCompliance(['1 cup panko breadcrumbs']);
  assert.equal(issues.length, 1);
  assert.deepEqual(issues[0].terms.sort(), ['breadcrumbs', 'panko']);
  assert.match(issues[0].message, /panko/);
});

test('protein sourcing follows Pantry standards', () => {
  assert.deepEqual(types('1 lb chicken breast'), ['sourcing']);
  assert.match(checkCompliance(['1 lb chicken breast']).warnings[0], /pastured/);
  assert.equal(ok('1 lb free-range chicken breast'), false, 'Pantry requires pastured, not free-range');
  assert.equal(ok('1 lb pasture-raised chicken breast'), true);
  assert.equal(ok('1 lb grass fed ground beef'), true);
  assert.deepEqual(types('2 lbs tri-tip'), ['sourcing']);
  assert.deepEqual(types('salmon fillet'), ['sourcing']);
  assert.equal(ok('wild-caught salmon fillet'), true);
  assert.equal(ok({ name: 'beef tenderloin', quantity: '1.5 lbs', sourcing_hint: 'grass-fed' }), true);
  assert.equal(ok({ name: 'swordfish steak', quantity: '1.5 lbs', sourcing_hint: 'wild-caught' }), true,
    '"steak" on a fish line is not beef');
  assert.equal(ok('cauliflower steak'), true);
});

test('the "sea bass" rule key is quoted and works', () => {
  assert.equal(PROTEIN_RULES['sea bass'], 'wild-caught');
  assert.deepEqual(types('2 sea bass fillets'), ['sourcing']);
  assert.equal(ok('2 wild-caught sea bass fillets'), true);
  assert.equal(detectProtein(['2 sea bass fillets']), 'fish');
});

test('derive, audit, and reconcile dietary flags', () => {
  assert.deepEqual(deriveDietaryFlags(['rice', 'coconut aminos']), ['gluten-free', 'sugar-free']);
  assert.deepEqual(deriveDietaryFlags(['penne', 'honey']), []);

  const audit = auditRecipe({ dietary_flags: ['gluten-free'], ingredients: [{ name: 'farro', quantity: '1 cup' }] });
  assert.deepEqual(audit.falseFlags, ['gluten-free']);
  assert.deepEqual(audit.missingFlags, ['sugar-free']);

  assert.deepEqual(
    reconcileDietaryFlags(['gluten-free', 'dairy-free'], ['farro', 'olive oil']).sort(),
    ['dairy-free', 'sugar-free']
  );
});

test('every seeded recipe passes the checker and claims only flags it meets', () => {
  const recipes = getSeedRecipes();
  assert.equal(recipes.length, 51);
  for (const recipe of recipes) {
    const audit = auditRecipe(recipe);
    assert.deepEqual(audit.falseFlags, [], `${recipe.name} claims ${audit.falseFlags}`);
    assert.deepEqual(audit.missingFlags, [], `${recipe.name} should also be ${audit.missingFlags}`);
    assert.equal(audit.sourcingOk, true, `${recipe.name}: ${audit.warnings.join('; ')}`);
  }
});

test('seed fixes: Lamb Flatiron is now truly gluten-free; soy sauce swapped for coconut aminos', () => {
  const byName = Object.fromEntries(getSeedRecipes().map((r) => [r.name, r]));
  const original = Object.fromEntries(getOriginalSeedRecipes().map((r) => [r.name, r]));

  assert.deepEqual(auditRecipe(original['Lamb Flatiron with Chimichurri']).falseFlags, ['gluten-free']);
  const lamb = byName['Lamb Flatiron with Chimichurri'];
  assert.ok(lamb.dietary_flags.includes('gluten-free'));
  assert.ok(lamb.ingredients.some((i) => i.name === 'quinoa'));
  assert.doesNotMatch(JSON.stringify(lamb), /farro/i);

  const thai = byName['Thai Basil Chicken'];
  assert.ok(thai.dietary_flags.includes('gluten-free') && thai.dietary_flags.includes('sugar-free'));
  assert.doesNotMatch(JSON.stringify(thai.ingredients), /soy sauce/);

  // Non-verifiable flags are preserved.
  assert.ok(byName['Grass-Fed Beef Tacos'].dietary_flags.includes('dairy-free'));
  assert.ok(byName['Shakshuka'].dietary_flags.includes('vegetarian'));
  assert.ok(!byName['Shakshuka'].dietary_flags.includes('gluten-free'));
});

test('sugar-free is offered everywhere diets are chosen', () => {
  const root = path.join(__dirname, '..');
  for (const file of ['views/onboarding.ejs', 'views/planner.ejs', 'views/profile.ejs', 'routes/profile.js']) {
    assert.match(fs.readFileSync(path.join(root, file), 'utf8'), /sugar-free/, file);
  }
});
