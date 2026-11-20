// Kroger has no Austin stores — remove it. Add Sprouts and Central Market.
//
// Sprouts and Central Market prices are ESTIMATES, not quotes: each is the
// seeded H-E-B price for the same ingredient and package, times a category
// markup, rounded to end in .x9. Every seeded price is flagged
// price_is_estimate = true and the UI labels them as estimates.
const STORES = [
  { name: 'Sprouts', slug: 'sprouts', logo_color: '#3F7D2C', website_url: 'https://www.sprouts.com' },
  { name: 'Central Market', slug: 'central-market', logo_color: '#8C1D40', website_url: 'https://www.centralmarket.com' },
];

// Markup over H-E-B by ingredient category.
const MARKUP = {
  sprouts: { Produce: 1.0, 'Meat & Seafood': 1.15, 'Dairy & Eggs': 1.1, Pantry: 1.1 },
  'central-market': { Produce: 1.2, 'Meat & Seafood': 1.3, 'Dairy & Eggs': 1.25, Pantry: 1.25 },
};
const DEFAULT_MARKUP = { sprouts: 1.1, 'central-market': 1.25 };

function estimate(hebPrice, multiplier) {
  const raw = Number(hebPrice) * multiplier;
  return Math.max(0.49, Math.floor(raw * 10) / 10 + 0.09).toFixed(2);
}

module.exports = {
  name: 'replace_kroger_with_sprouts_central_market',
  STORES,
  MARKUP,
  estimate,
  up: async (client) => {
    await client.query(`DELETE FROM price_entries WHERE store_id IN (SELECT id FROM stores WHERE slug = 'kroger')`);
    await client.query(`DELETE FROM stores WHERE slug = 'kroger'`);

    for (const store of STORES) {
      await client.query(
        `INSERT INTO stores (name, slug, logo_color, website_url) VALUES ($1, $2, $3, $4)
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, logo_color = EXCLUDED.logo_color, website_url = EXCLUDED.website_url`,
        [store.name, store.slug, store.logo_color, store.website_url]
      );
    }

    const heb = await client.query(`
      SELECT pe.ingredient_id, pe.price, pe.unit, pe.package_quantity, pe.package_unit, i.category
      FROM price_entries pe
      JOIN stores s ON s.id = pe.store_id
      JOIN ingredients i ON i.id = pe.ingredient_id
      WHERE s.slug = 'heb'
    `);

    for (const store of STORES) {
      const { rows } = await client.query('SELECT id FROM stores WHERE slug = $1', [store.slug]);
      const storeId = rows[0].id;
      await client.query('DELETE FROM price_entries WHERE store_id = $1', [storeId]);
      for (const row of heb.rows) {
        const multiplier = MARKUP[store.slug][row.category] ?? DEFAULT_MARKUP[store.slug];
        await client.query(
          `INSERT INTO price_entries (store_id, ingredient_id, price, unit, deal, deal_description, package_quantity, package_unit, price_is_estimate)
           VALUES ($1, $2, $3, $4, false, NULL, $5, $6, true)`,
          [storeId, row.ingredient_id, estimate(row.price, multiplier), row.unit, row.package_quantity, row.package_unit]
        );
      }
    }

    // All seeded prices are estimates — none come from a live store feed.
    await client.query('UPDATE price_entries SET price_is_estimate = true WHERE price_is_estimate IS DISTINCT FROM true');
  },
};
