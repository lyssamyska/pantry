// Expand price seed: cover the ~13 most-used planner ingredients that the
// initial seed missed — specific beef cuts, beef broth, sour cream, cheddar,
// the bare herb names, and a rice variant — so most grocery lines resolve a
// store + price instead of falling back to the em-dash in views/planner.ejs.
const INGREDIENTS = [
  { name: "beef tenderloin", category: "Meat & Seafood", unit: "lb", sourcing_hint: "grass-fed" },
  { name: "beef sirloin", category: "Meat & Seafood", unit: "lb", sourcing_hint: "grass-fed" },
  { name: "beef chuck", category: "Meat & Seafood", unit: "lb", sourcing_hint: "grass-fed" },
  { name: "beef short ribs", category: "Meat & Seafood", unit: "lb", sourcing_hint: "grass-fed" },
  { name: "beef flank steak", category: "Meat & Seafood", unit: "lb", sourcing_hint: "grass-fed" },
  { name: "beef broth", category: "Pantry", unit: "carton" },
  { name: "sour cream", category: "Dairy & Eggs", unit: "container" },
  { name: "cheddar cheese", category: "Dairy & Eggs", unit: "block" },
  { name: "basil", category: "Produce", unit: "bunch" },
  { name: "parsley", category: "Produce", unit: "bunch" },
  { name: "thyme", category: "Produce", unit: "bunch" },
  { name: "oregano", category: "Produce", unit: "bunch" },
  { name: "jasmine rice", category: "Pantry", unit: "lb" }
];

// price_entries: [store_slug, ingredient_name, price, unit, is_deal, deal_description]
const PRICE_ENTRIES = [
  // H-E-B — generally the cheapest on produce and meat in Austin
  ["heb", "beef tenderloin", 14.99, "lb", false, null],
  ["heb", "beef sirloin", 11.99, "lb", false, null],
  ["heb", "beef chuck", 9.99, "lb", false, null],
  ["heb", "beef short ribs", 11.99, "lb", true, "Manager's Special"],
  ["heb", "beef flank steak", 12.99, "lb", false, null],
  ["heb", "beef broth", 3.49, "carton", false, null],
  ["heb", "sour cream", 2.49, "container", false, null],
  ["heb", "cheddar cheese", 4.99, "block", false, null],
  ["heb", "basil", 1.99, "bunch", false, null],
  ["heb", "parsley", 1.49, "bunch", false, null],
  ["heb", "thyme", 1.99, "bunch", false, null],
  ["heb", "oregano", 1.99, "bunch", true, "Manager's Special"],
  ["heb", "jasmine rice", 2.99, "lb", false, null],
  // Whole Foods — premium tier, modestly above H-E-B on produce and meat
  ["whole-foods", "beef tenderloin", 16.99, "lb", false, null],
  ["whole-foods", "beef sirloin", 13.99, "lb", false, null],
  ["whole-foods", "beef chuck", 11.49, "lb", false, null],
  ["whole-foods", "beef short ribs", 12.99, "lb", false, null],
  ["whole-foods", "beef flank steak", 14.49, "lb", false, null],
  ["whole-foods", "beef broth", 4.49, "carton", false, null],
  ["whole-foods", "sour cream", 3.49, "container", false, null],
  ["whole-foods", "cheddar cheese", 5.99, "block", false, null],
  ["whole-foods", "basil", 2.79, "bunch", false, null],
  ["whole-foods", "parsley", 2.29, "bunch", false, null],
  ["whole-foods", "thyme", 2.99, "bunch", false, null],
  ["whole-foods", "oregano", 2.79, "bunch", false, null],
  ["whole-foods", "jasmine rice", 3.99, "lb", false, null]
];

module.exports = {
  name: 'expand_price_seed_top50',
  up: async (client) => {
    // Seed ingredients — ON CONFLICT (name) DO NOTHING keeps re-runs idempotent.
    for (const ing of INGREDIENTS) {
      await client.query(
        `INSERT INTO ingredients (name, category, unit, sourcing_hint) VALUES ($1, $2, $3, $4) ON CONFLICT (name) DO NOTHING`,
        [ing.name, ing.category, ing.unit, ing.sourcing_hint || null]
      );
    }
    console.log(`Seeded ${INGREDIENTS.length} ingredients`);

    // Seed price entries — same lookup-and-insert pattern as the original
    // seed_price_data migration. ON CONFLICT DO NOTHING tolerates duplicates
    // from a re-run; getBestPrice orders by price ASC so extras don't matter.
    let inserted = 0;
    for (const [storeSlug, ingredientName, price, unit, isDeal, dealDesc] of PRICE_ENTRIES) {
      const storeResult = await client.query(`SELECT id FROM stores WHERE slug = $1`, [storeSlug]);
      const ingResult = await client.query(`SELECT id FROM ingredients WHERE name = $1`, [ingredientName]);
      if (storeResult.rows[0] && ingResult.rows[0]) {
        await client.query(
          `INSERT INTO price_entries (store_id, ingredient_id, price, unit, deal, deal_description)
           VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
          [storeResult.rows[0].id, ingResult.rows[0].id, price, unit, isDeal, dealDesc]
        );
        inserted += 1;
      }
    }
    console.log(`Seeded ${inserted} price entries`);
  }
};
