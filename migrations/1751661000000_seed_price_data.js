// Seed price data: stores, ingredients, and price entries for cross-store price comparison.
const STORES = [
  { name: "H-E-B", slug: "heb", logo_color: "#1A5EA8", website_url: "https://www.heb.com" },
  { name: "Kroger", slug: "kroger", logo_color: "#CC0000", website_url: "https://www.kroger.com" },
  { name: "Whole Foods", slug: "whole-foods", logo_color: "#7B3F00", website_url: "https://www.wholefoods.com" },
  { name: "Barton Springs Market", slug: "barton-springs", logo_color: "#2A4D1E", website_url: "https://www.bartonspringsmarket.com" }
];

const INGREDIENTS = [
  // Produce
  { name: "arugula", category: "Produce", unit: "bunch" },
  { name: "avocado", category: "Produce", unit: "each" },
  { name: "bell pepper", category: "Produce", unit: "each" },
  { name: "broccoli", category: "Produce", unit: "bunch" },
  { name: "carrot", category: "Produce", unit: "bunch" },
  { name: "cherry tomato", category: "Produce", unit: "pint" },
  { name: "cilantro", category: "Produce", unit: "bunch" },
  { name: "garlic", category: "Produce", unit: "head" },
  { name: "ginger", category: "Produce", unit: "each" },
  { name: "kale", category: "Produce", unit: "bunch" },
  { name: "lemon", category: "Produce", unit: "each" },
  { name: "onion", category: "Produce", unit: "each" },
  { name: "potato", category: "Produce", unit: "lb" },
  { name: "scallion", category: "Produce", unit: "bunch" },
  { name: "spinach", category: "Produce", unit: "bag" },
  { name: "zucchini", category: "Produce", unit: "each" },
  // Meat & Seafood
  { name: "chicken breast", category: "Meat & Seafood", unit: "lb", sourcing_hint: "pastured" },
  { name: "chicken thighs", category: "Meat & Seafood", unit: "lb", sourcing_hint: "pastured" },
  { name: "ground beef", category: "Meat & Seafood", unit: "lb", sourcing_hint: "grass-fed" },
  { name: "salmon fillet", category: "Meat & Seafood", unit: "lb", sourcing_hint: "wild-caught" },
  { name: "shrimp", category: "Meat & Seafood", unit: "lb", sourcing_hint: "wild-caught" },
  { name: "bacon", category: "Meat & Seafood", unit: "package" },
  { name: "pork tenderloin", category: "Meat & Seafood", unit: "lb" },
  // Dairy & Eggs
  { name: "butter", category: "Dairy & Eggs", unit: "stick" },
  { name: "egg", category: "Dairy & Eggs", unit: "dozen", sourcing_hint: "pasture-raised" },
  { name: "heavy cream", category: "Dairy & Eggs", unit: "pint" },
  { name: "milk", category: "Dairy & Eggs", unit: "gallon" },
  { name: "parmesan", category: "Dairy & Eggs", unit: "wedge" },
  { name: "feta cheese", category: "Dairy & Eggs", unit: "block" },
  { name: "cream cheese", category: "Dairy & Eggs", unit: "package" },
  // Pantry
  { name: "olive oil", category: "Pantry", unit: "bottle" },
  { name: "rice", category: "Pantry", unit: "lb" },
  { name: "pasta", category: "Pantry", unit: "box" },
  { name: "chicken broth", category: "Pantry", unit: "carton" },
  { name: "soy sauce", category: "Pantry", unit: "bottle" },
  { name: "tomato paste", category: "Pantry", unit: "can" },
  { name: "black beans", category: "Pantry", unit: "can" },
  { name: "chickpeas", category: "Pantry", unit: "can" },
  { name: "coconut milk", category: "Pantry", unit: "can" }
];

// price_entries: [store_slug, ingredient_name, price, unit, is_deal, deal_description]
const PRICE_ENTRIES = [
  // H-E-B prices
  ["heb", "arugula", 3.49, "bunch", false, null],
  ["heb", "avocado", 1.99, "each", true, "2 for $3"],
  ["heb", "bell pepper", 1.29, "each", false, null],
  ["heb", "broccoli", 2.49, "bunch", false, null],
  ["heb", "carrot", 1.99, "bunch", false, null],
  ["heb", "cherry tomato", 3.99, "pint", false, null],
  ["heb", "cilantro", 0.99, "bunch", true, "Limit 3"],
  ["heb", "garlic", 0.59, "head", false, null],
  ["heb", "ginger", 2.49, "each", false, null],
  ["heb", "kale", 2.99, "bunch", false, null],
  ["heb", "lemon", 0.79, "each", false, null],
  ["heb", "onion", 0.79, "each", false, null],
  ["heb", "potato", 1.49, "lb", false, null],
  ["heb", "scallion", 0.99, "bunch", false, null],
  ["heb", "spinach", 3.99, "bag", false, null],
  ["heb", "zucchini", 1.49, "each", false, null],
  ["heb", "chicken breast", 4.99, "lb", true, "Manager's Special"],
  ["heb", "chicken thighs", 3.99, "lb", false, null],
  ["heb", "ground beef", 6.99, "lb", true, "Grass-Fed"],
  ["heb", "salmon fillet", 12.99, "lb", false, null],
  ["heb", "shrimp", 9.99, "lb", false, null],
  ["heb", "bacon", 7.49, "package", false, null],
  ["heb", "pork tenderloin", 5.99, "lb", false, null],
  ["heb", "butter", 3.49, "stick", false, null],
  ["heb", "egg", 4.99, "dozen", true, "Pasture-Raised"],
  ["heb", "heavy cream", 3.99, "pint", false, null],
  ["heb", "milk", 4.49, "gallon", false, null],
  ["heb", "parmesan", 6.99, "wedge", false, null],
  ["heb", "feta cheese", 5.49, "block", false, null],
  ["heb", "cream cheese", 3.99, "package", false, null],
  ["heb", "olive oil", 8.99, "bottle", false, null],
  ["heb", "rice", 2.49, "lb", false, null],
  ["heb", "pasta", 1.99, "box", false, null],
  ["heb", "chicken broth", 2.49, "carton", false, null],
  ["heb", "soy sauce", 3.49, "bottle", false, null],
  ["heb", "tomato paste", 1.29, "can", false, null],
  ["heb", "black beans", 0.99, "can", true, "2 for $1.50"],
  ["heb", "chickpeas", 1.29, "can", false, null],
  ["heb", "coconut milk", 2.29, "can", false, null],
  // Kroger prices
  ["kroger", "arugula", 3.99, "bunch", false, null],
  ["kroger", "avocado", 1.49, "each", true, "Buy 2 Get 1 Free"],
  ["kroger", "bell pepper", 0.99, "each", false, null],
  ["kroger", "broccoli", 1.99, "bunch", true, "Kroger Brand"],
  ["kroger", "carrot", 1.49, "bunch", false, null],
  ["kroger", "cherry tomato", 3.49, "pint", false, null],
  ["kroger", "cilantro", 0.79, "bunch", false, null],
  ["kroger", "garlic", 0.49, "head", false, null],
  ["kroger", "ginger", 2.99, "each", false, null],
  ["kroger", "kale", 2.49, "bunch", false, null],
  ["kroger", "lemon", 0.59, "each", true, "Club Price"],
  ["kroger", "onion", 0.59, "each", false, null],
  ["kroger", "potato", 1.29, "lb", false, null],
  ["kroger", "scallion", 0.79, "bunch", false, null],
  ["kroger", "spinach", 2.99, "bag", true, "Kroger Brand"],
  ["kroger", "zucchini", 0.99, "each", false, null],
  ["kroger", "chicken breast", 5.49, "lb", false, null],
  ["kroger", "chicken thighs", 3.49, "lb", false, null],
  ["kroger", "ground beef", 8.49, "lb", false, null],
  ["kroger", "salmon fillet", 13.99, "lb", false, null],
  ["kroger", "shrimp", 11.99, "lb", false, null],
  ["kroger", "bacon", 6.99, "package", false, null],
  ["kroger", "pork tenderloin", 4.99, "lb", false, null],
  ["kroger", "butter", 2.99, "stick", true, "Weekly Deal"],
  ["kroger", "egg", 3.79, "dozen", false, null],
  ["kroger", "heavy cream", 3.49, "pint", false, null],
  ["kroger", "milk", 3.99, "gallon", true, "Kroger Brand"],
  ["kroger", "parmesan", 7.49, "wedge", false, null],
  ["kroger", "feta cheese", 4.99, "block", false, null],
  ["kroger", "cream cheese", 2.99, "package", true, "Kroger Brand"],
  ["kroger", "olive oil", 7.99, "bottle", false, null],
  ["kroger", "rice", 1.99, "lb", false, null],
  ["kroger", "pasta", 1.49, "box", false, null],
  ["kroger", "chicken broth", 1.99, "carton", true, "Kroger Brand"],
  ["kroger", "soy sauce", 2.99, "bottle", false, null],
  ["kroger", "tomato paste", 0.89, "can", false, null],
  ["kroger", "black beans", 0.79, "can", false, null],
  ["kroger", "chickpeas", 0.99, "can", false, null],
  ["kroger", "coconut milk", 1.99, "can", false, null],
  // Whole Foods prices
  ["whole-foods", "arugula", 4.49, "bunch", false, null],
  ["whole-foods", "avocado", 2.29, "each", false, null],
  ["whole-foods", "bell pepper", 1.79, "each", false, null],
  ["whole-foods", "broccoli", 3.49, "bunch", false, null],
  ["whole-foods", "carrot", 2.49, "bunch", false, null],
  ["whole-foods", "cherry tomato", 4.99, "pint", false, null],
  ["whole-foods", "cilantro", 1.29, "bunch", false, null],
  ["whole-foods", "garlic", 0.79, "head", false, null],
  ["whole-foods", "ginger", 3.49, "each", false, null],
  ["whole-foods", "kale", 3.49, "bunch", false, null],
  ["whole-foods", "lemon", 0.99, "each", false, null],
  ["whole-foods", "onion", 0.89, "each", false, null],
  ["whole-foods", "potato", 1.79, "lb", false, null],
  ["whole-foods", "scallion", 1.29, "bunch", false, null],
  ["whole-foods", "spinach", 4.49, "bag", false, null],
  ["whole-foods", "zucchini", 1.79, "each", false, null],
  ["whole-foods", "chicken breast", 6.99, "lb", false, null],
  ["whole-foods", "chicken thighs", 5.49, "lb", false, null],
  ["whole-foods", "ground beef", 8.99, "lb", false, null],
  ["whole-foods", "salmon fillet", 14.99, "lb", false, null],
  ["whole-foods", "shrimp", 12.99, "lb", false, null],
  ["whole-foods", "bacon", 9.99, "package", false, null],
  ["whole-foods", "pork tenderloin", 7.49, "lb", false, null],
  ["whole-foods", "butter", 4.99, "stick", false, null],
  ["whole-foods", "egg", 5.99, "dozen", false, null],
  ["whole-foods", "heavy cream", 4.49, "pint", false, null],
  ["whole-foods", "milk", 5.49, "gallon", false, null],
  ["whole-foods", "parmesan", 8.99, "wedge", false, null],
  ["whole-foods", "feta cheese", 6.49, "block", false, null],
  ["whole-foods", "cream cheese", 4.49, "package", false, null],
  ["whole-foods", "olive oil", 10.99, "bottle", false, null],
  ["whole-foods", "rice", 2.99, "lb", false, null],
  ["whole-foods", "pasta", 2.49, "box", false, null],
  ["whole-foods", "chicken broth", 3.49, "carton", false, null],
  ["whole-foods", "soy sauce", 4.49, "bottle", false, null],
  ["whole-foods", "tomato paste", 1.49, "can", false, null],
  ["whole-foods", "black beans", 1.49, "can", false, null],
  ["whole-foods", "chickpeas", 1.69, "can", false, null],
  ["whole-foods", "coconut milk", 2.99, "can", false, null],
  // Barton Springs prices
  ["barton-springs", "arugula", 4.29, "bunch", false, null],
  ["barton-springs", "avocado", 1.79, "each", false, null],
  ["barton-springs", "bell pepper", 1.49, "each", false, null],
  ["barton-springs", "broccoli", 2.99, "bunch", false, null],
  ["barton-springs", "carrot", 2.29, "bunch", false, null],
  ["barton-springs", "cherry tomato", 4.49, "pint", false, null],
  ["barton-springs", "cilantro", 0.99, "bunch", false, null],
  ["barton-springs", "garlic", 0.59, "head", false, null],
  ["barton-springs", "ginger", 2.99, "each", false, null],
  ["barton-springs", "kale", 3.29, "bunch", false, null],
  ["barton-springs", "lemon", 0.69, "each", false, null],
  ["barton-springs", "onion", 0.69, "each", false, null],
  ["barton-springs", "potato", 1.49, "lb", false, null],
  ["barton-springs", "scallion", 0.89, "bunch", false, null],
  ["barton-springs", "spinach", 3.99, "bag", false, null],
  ["barton-springs", "zucchini", 1.29, "each", false, null],
  ["barton-springs", "chicken breast", 5.99, "lb", false, null],
  ["barton-springs", "chicken thighs", 4.49, "lb", false, null],
  ["barton-springs", "ground beef", 7.99, "lb", false, null],
  ["barton-springs", "salmon fillet", 13.99, "lb", false, null],
  ["barton-springs", "shrimp", 10.99, "lb", false, null],
  ["barton-springs", "bacon", 8.49, "package", false, null],
  ["barton-springs", "pork tenderloin", 6.49, "lb", false, null],
  ["barton-springs", "butter", 3.79, "stick", false, null],
  ["barton-springs", "egg", 5.49, "dozen", false, null],
  ["barton-springs", "heavy cream", 4.29, "pint", false, null],
  ["barton-springs", "milk", 4.99, "gallon", false, null],
  ["barton-springs", "parmesan", 7.29, "wedge", false, null],
  ["barton-springs", "feta cheese", 5.99, "block", false, null],
  ["barton-springs", "cream cheese", 4.29, "package", false, null],
  ["barton-springs", "olive oil", 9.49, "bottle", false, null],
  ["barton-springs", "rice", 2.79, "lb", false, null],
  ["barton-springs", "pasta", 2.29, "box", false, null],
  ["barton-springs", "chicken broth", 2.79, "carton", false, null],
  ["barton-springs", "soy sauce", 3.79, "bottle", false, null],
  ["barton-springs", "tomato paste", 1.19, "can", false, null],
  ["barton-springs", "black beans", 1.19, "can", false, null],
  ["barton-springs", "chickpeas", 1.49, "can", false, null],
  ["barton-springs", "coconut milk", 2.49, "can", false, null]
];

module.exports = {
  name: 'seed_price_data',
  up: async (client) => {
    // Create stores table
    await client.query(`
      CREATE TABLE IF NOT EXISTS stores (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(100) NOT NULL UNIQUE,
        logo_color VARCHAR(20),
        website_url VARCHAR(255)
      )
    `);

    // Create ingredients table
    await client.query(`
      CREATE TABLE IF NOT EXISTS ingredients (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        category VARCHAR(100) NOT NULL,
        unit VARCHAR(50) DEFAULT 'each',
        sourcing_hint VARCHAR(255)
      )
    `);

    // Create price_entries table
    await client.query(`
      CREATE TABLE IF NOT EXISTS price_entries (
        id SERIAL PRIMARY KEY,
        store_id INTEGER REFERENCES stores(id),
        ingredient_id INTEGER REFERENCES ingredients(id),
        price DECIMAL(10,2) NOT NULL,
        unit VARCHAR(50) NOT NULL,
        deal BOOLEAN DEFAULT false,
        deal_description VARCHAR(255),
        verified_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Indexes for price lookups
    await client.query(`CREATE INDEX IF NOT EXISTS idx_price_entries_ingredient ON price_entries (ingredient_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_price_entries_store ON price_entries (store_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_price_entries_price ON price_entries (price)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ingredients_category ON ingredients (category)`);

    // Seed stores
    for (const s of STORES) {
      await client.query(
        `INSERT INTO stores (name, slug, logo_color, website_url) VALUES ($1, $2, $3, $4) ON CONFLICT (slug) DO NOTHING`,
        [s.name, s.slug, s.logo_color, s.website_url]
      );
    }
    console.log(`Seeded ${STORES.length} stores`);

    // Seed ingredients
    for (const ing of INGREDIENTS) {
      await client.query(
        `INSERT INTO ingredients (name, category, unit, sourcing_hint) VALUES ($1, $2, $3, $4) ON CONFLICT (name) DO NOTHING`,
        [ing.name, ing.category, ing.unit, ing.sourcing_hint || null]
      );
    }
    console.log(`Seeded ${INGREDIENTS.length} ingredients`);

    // Seed price entries
    for (const [storeSlug, ingredientName, price, unit, isDeal, dealDesc] of PRICE_ENTRIES) {
      const storeResult = await client.query(`SELECT id FROM stores WHERE slug = $1`, [storeSlug]);
      const ingResult = await client.query(`SELECT id FROM ingredients WHERE name = $1`, [ingredientName]);
      if (storeResult.rows[0] && ingResult.rows[0]) {
        await client.query(
          `INSERT INTO price_entries (store_id, ingredient_id, price, unit, deal, deal_description)
           VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
          [storeResult.rows[0].id, ingResult.rows[0].id, price, unit, isDeal, dealDesc]
        );
      }
    }
    console.log(`Seeded ${PRICE_ENTRIES.length} price entries`);
  }
};