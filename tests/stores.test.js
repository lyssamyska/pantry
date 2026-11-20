const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const retailers = require('../lib/austin-retailers');
const storeMigration = require('../migrations/1790600200000_replace_kroger_with_sprouts_central_market');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Sprouts and Central Market are supported Austin retailers; Kroger is not', () => {
  for (const slug of ['heb', 'whole-foods', 'sprouts', 'central-market', 'barton-springs']) {
    assert.equal(retailers.isSupportedAustinStoreSlug(slug), true, slug);
  }
  assert.equal(retailers.isSupportedAustinStoreSlug('kroger'), false);
  assert.equal(retailers.isSupportedAustinStoreName('Sprouts'), true);
  assert.equal(retailers.isSupportedAustinStoreName('Central Market'), true);
  assert.equal(retailers.isSupportedAustinStoreName('Kroger'), false);
});

test('price selection can pick Sprouts or Central Market, and still prefers H-E-B', () => {
  const rows = [
    { store_slug: 'kroger', store_name: 'Kroger', price: '0.50' },
    { store_slug: 'central-market', store_name: 'Central Market', price: '3.00' },
    { store_slug: 'sprouts', store_name: 'Sprouts', price: '2.00' },
  ];
  assert.equal(retailers.selectAustinPrice(rows).store_slug, 'sprouts');
  assert.equal(retailers.selectAustinPrice([...rows, { store_slug: 'heb', price: '9.99' }]).store_slug, 'heb');
});

test('no seed migration inserts Kroger', () => {
  for (const file of fs.readdirSync(path.join(root, 'migrations'))) {
    if (file === '1790600200000_replace_kroger_with_sprouts_central_market.js') continue;
    assert.doesNotMatch(read(`migrations/${file}`), /kroger/i, file);
  }
});

test('store migration removes Kroger, adds both stores, and marks every price an estimate', async () => {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      if (/SELECT id FROM stores WHERE slug/.test(sql)) return { rows: [{ id: params[0] === 'sprouts' ? 10 : 11 }] };
      if (/WHERE s.slug = 'heb'/.test(sql)) {
        return { rows: [
          { ingredient_id: 1, price: '1.99', unit: 'bunch', package_quantity: null, package_unit: null, category: 'Produce' },
          { ingredient_id: 2, price: '10.00', unit: 'lb', package_quantity: '1', package_unit: 'lb', category: 'Meat & Seafood' },
        ] };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  await storeMigration.up(client);

  assert.ok(calls.some((c) => /DELETE FROM stores WHERE slug = 'kroger'/.test(c.sql)));
  assert.ok(calls.some((c) => /DELETE FROM price_entries WHERE store_id IN \(SELECT id FROM stores WHERE slug = 'kroger'\)/.test(c.sql)));

  const storeInserts = calls.filter((c) => /INSERT INTO stores/.test(c.sql)).map((c) => c.params[1]);
  assert.deepEqual(storeInserts, ['sprouts', 'central-market']);

  const prices = calls.filter((c) => /INSERT INTO price_entries/.test(c.sql));
  assert.equal(prices.length, 4);
  assert.ok(prices.every((c) => /price_is_estimate\) VALUES .*true\)$/.test(c.sql)));
  const priceFor = (storeId, ingredientId) => prices.find((c) => c.params[0] === storeId && c.params[1] === ingredientId).params[2];
  assert.equal(priceFor(10, 1), '1.99'); // Sprouts produce ≈ H-E-B
  assert.equal(priceFor(10, 2), '11.59'); // Sprouts meat +15%
  assert.equal(priceFor(11, 2), '13.09'); // Central Market meat +30%

  assert.ok(calls.some((c) => /UPDATE price_entries SET price_is_estimate = true/.test(c.sql)));
});

test('the UI labels prices as estimates wherever they appear', () => {
  assert.match(retailers.PRICE_ESTIMATE_NOTICE, /estimates/);
  assert.match(read('server.js'), /app\.locals\.priceEstimateNotice/);
  assert.match(read('views/planner.ejs'), /<%= priceEstimateNotice %>/);
  assert.match(read('views/planner.ejs'), /price_is_estimate \? 'Est\. ~'/);
  assert.match(read('views/planner-export.ejs'), /<%= priceEstimateNotice %>/);
  assert.match(read('views/planner-export.ejs'), /'Est\. ~\$'/);
  assert.match(read('views/partials/planner-export-grocery.ejs'), /Est\. ~\$/);
});
