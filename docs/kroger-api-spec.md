# Kroger API Integration Spec

Authoritative technical spec for ingesting live Kroger prices into the Pantry price comparison schema via the OAuth2-protected Kroger Products API (`developer.kroger.com`).

---

## 1. Context

Pantry already has a normalized price comparison schema (`stores`, `ingredients`, `price_entries`) with Kroger pre-seeded as a store (`slug = "kroger"`, `id` resolved at runtime from the stores table). The current price data is static seed data (`migrations/1751661000000_seed_price_data.js`). This spec describes how to replace and continuously refresh Kroger rows in `price_entries` with live data from `developer.kroger.com`.

---

## 2. Authentication — OAuth2 Client Credentials

**Token endpoint:**
```
POST https://api.kroger.com/v1/connect/oauth2/token
Content-Type: application/x-www-form-urlencoded
Authorization: Basic {base64(KROGER_CLIENT_ID + ":" + KROGER_CLIENT_SECRET)}

grant_type=client_credentials&scope=product.compact
```

**Token response:**
```json
{
  "access_token": "eyJ...",
  "token_type": "Bearer",
  "expires_in": 1800
}
```

**Token caching rule:** store `{ token, expiresAt: Date.now() + (expires_in - 60) * 1000 }` in module scope. Re-fetch when `Date.now() >= expiresAt`. Never make a product request without first checking the cache.

**Implement as:** `lib/kroger-client.js` — exports an async `getAccessToken()` function with the cached token logic, and a `krogerGet(path, params)` helper that calls `getAccessToken()` then issues the request with `Authorization: Bearer {token}`.

**Environment variables required:**
- `KROGER_CLIENT_ID` — from developer.kroger.com app registration
- `KROGER_CLIENT_SECRET` — from developer.kroger.com app registration
- `KROGER_LOCATION_ID` — Kroger store location ID for an Austin, TX store (obtain once by calling `GET /v1/locations?filter.zipCode=78701&filter.chain=Kroger&filter.limit=1`; hardcode the returned `locationId` as the default)

---

## 3. Product Search Endpoint

```
GET https://api.kroger.com/v1/products
Authorization: Bearer {access_token}

Query params:
  filter.term         = {ingredient name, e.g. "salmon fillet"}
  filter.locationId   = {KROGER_LOCATION_ID}
  filter.limit        = 5
```

**Response shape (relevant fields only):**
```json
{
  "data": [
    {
      "productId": "0001111041700",
      "description": "Kroger Wild Caught Pink Salmon Fillet",
      "items": [
        {
          "price": {
            "regular": 13.99,
            "promo": 11.99
          },
          "size": "1 lb",
          "soldBy": "UNIT"
        }
      ]
    }
  ]
}
```

**Product selection rule:** use `data[0]` (first result). If `data` is empty or the HTTP status is non-200, skip that ingredient and log a warning — do not throw.

**Rate limits:** Kroger allows ~1 req/sec on the sandbox tier. The sync job must `await` a 1100ms delay between each product search call. Document this as `const RATE_LIMIT_MS = 1100`.

---

## 4. Data Mapping — Kroger API → Pantry Schema

| Kroger field | Pantry schema | Notes |
|---|---|---|
| `data[0].productId` | `ingredients.kroger_product_id` | new column; used for future direct lookup by UPC |
| `data[0].items[0].price.promo ?? data[0].items[0].price.regular` | `price_entries.price` | prefer promo if non-null |
| `data[0].items[0].price.promo !== null` | `price_entries.deal` | `true` when promo price exists |
| `"Sale: $X.XX (reg $Y.YY)"` | `price_entries.deal_description` | formatted string when `deal = true`; `null` otherwise |
| `data[0].items[0].size` | `price_entries.unit` | e.g. `"1 lb"`, `"12 oz"` |
| `NOW()` | `price_entries.verified_at` | written on each successful sync |
| Kroger store row `id` | `price_entries.store_id` | resolved via `SELECT id FROM stores WHERE slug = 'kroger'` |
| existing `ingredients.id` | `price_entries.ingredient_id` | resolved via `getIngredientByName(ingredientName)` |

**Ingredient matching:** The sync job iterates the `ingredients` table (via `getAllIngredients()`), searches Kroger for each ingredient's `name`, and maps the result back to that row by `ingredient_id`. If `getIngredientByName` returns null (ingredient not yet in DB), skip — do not auto-create ingredients during a price sync.

---

## 5. Schema Changes Required

**Migration file:** `migrations/{timestamp}_kroger_price_sync_schema.js`

Changes (all idempotent):

1. Add `kroger_product_id VARCHAR(255)` column to `ingredients`:
   ```sql
   ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS kroger_product_id VARCHAR(255);
   CREATE INDEX IF NOT EXISTS idx_ingredients_kroger_product_id ON ingredients (kroger_product_id);
   ```

2. Add unique constraint on `(store_id, ingredient_id)` to `price_entries` so upserts work cleanly:
   ```sql
   ALTER TABLE price_entries
     ADD CONSTRAINT price_entries_store_ingredient_unique
     UNIQUE (store_id, ingredient_id);
   ```
   This is safe to add if the seed data has already been applied: the seed script inserts at most one row per `(store_slug, ingredient_name)` pair. Wrap in a `DO $$ ... EXCEPTION WHEN duplicate_table THEN NULL; END $$;` block for idempotency if the constraint may already exist.

---

## 6. New Database Functions Required

**File:** `db/prices.js` — add `upsertPriceEntry` alongside the existing `upsertIngredient` (currently at line 47):

```js
async function upsertPriceEntry(storeId, ingredientId, price, unit, deal, dealDescription) {
  const result = await pool.query(`
    INSERT INTO price_entries (store_id, ingredient_id, price, unit, deal, deal_description, verified_at)
    VALUES ($1, $2, $3, $4, $5, $6, NOW())
    ON CONFLICT (store_id, ingredient_id) DO UPDATE SET
      price = EXCLUDED.price,
      unit = EXCLUDED.unit,
      deal = EXCLUDED.deal,
      deal_description = EXCLUDED.deal_description,
      verified_at = NOW()
    RETURNING *
  `, [storeId, ingredientId, price, unit, deal, dealDescription]);
  return result.rows[0];
}
```

Export it alongside the existing exports at line 78.

Also add `updateIngredientKrogerProductId(ingredientId, krogerProductId)` to persist the resolved product ID:
```js
async function updateIngredientKrogerProductId(ingredientId, krogerProductId) {
  await pool.query(
    `UPDATE ingredients SET kroger_product_id = $1 WHERE id = $2`,
    [krogerProductId, ingredientId]
  );
}
```

---

## 7. Sync Job

**File:** `jobs/kroger-price-sync.js`

The job must be a standalone Node script that exits after completing (no persistent process). Pattern:

```js
require('dotenv').config();          // load env if running locally
const { pool } = require('../db/index');
const pricesDb = require('../db/prices');
const { krogerGet } = require('../lib/kroger-client');

const RATE_LIMIT_MS = 1100;

async function run() {
  const krogerStore = (await pool.query(`SELECT id FROM stores WHERE slug = 'kroger'`)).rows[0];
  if (!krogerStore) throw new Error('Kroger store row missing — run migrations first');

  const ingredients = await pricesDb.getAllIngredients();
  let synced = 0, skipped = 0, errors = 0;

  for (const ing of ingredients) {
    try {
      const data = await krogerGet('/v1/products', {
        'filter.term': ing.name,
        'filter.locationId': process.env.KROGER_LOCATION_ID,
        'filter.limit': 5
      });

      const product = data?.data?.[0];
      if (!product) { skipped++; continue; }

      const item = product.items?.[0];
      if (!item?.price) { skipped++; continue; }

      const hasPromo = item.price.promo != null && item.price.promo !== item.price.regular;
      const price = hasPromo ? item.price.promo : item.price.regular;
      const dealDesc = hasPromo
        ? `Sale: $${item.price.promo.toFixed(2)} (reg $${item.price.regular.toFixed(2)})`
        : null;

      await pricesDb.upsertPriceEntry(
        krogerStore.id, ing.id, price, item.size || ing.unit, hasPromo, dealDesc
      );

      if (product.productId && product.productId !== ing.kroger_product_id) {
        await pricesDb.updateIngredientKrogerProductId(ing.id, product.productId);
      }

      synced++;
    } catch (err) {
      console.error(`[kroger-sync] error on "${ing.name}":`, err.message);
      errors++;
    }

    await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
  }

  console.log(`[kroger-sync] done — synced: ${synced}, skipped: ${skipped}, errors: ${errors}`);
  await pool.end();
}

run().catch(err => { console.error(err); process.exit(1); });
```

---

## 8. Cron Declaration

**File:** `polsia.toml` (new file at repo root)

```toml
[[crons]]
name    = "kroger-price-sync"
schedule = "0 6 * * *"         # daily at 06:00 UTC (01:00 Austin CT)
command  = "node jobs/kroger-price-sync.js"
```

The job runs in an isolated container that exits — matching the platform cron contract. No `node-cron` or `setInterval` in `server.js`.

---

## 9. Error Handling and Edge Cases

| Scenario | Handling |
|---|---|
| Token request fails (5xx or network error) | Throw — job exits non-zero, platform retries on next schedule |
| Token request returns 401 | Log and throw — bad credentials, needs operator action |
| Product search returns 401 | Clear cached token and retry once (token may have expired mid-job due to a long run) |
| Product search returns 429 (rate limited) | Log warning, `await` 5000ms extra, continue |
| Product search returns 404 or empty `data[]` | `skipped++`, continue |
| `KROGER_LOCATION_ID` env var missing | Throw at job startup before any API calls |
| No `kroger` row in `stores` table | Throw at job startup — migration not applied |

---

## 10. Manual Smoke-Test Steps (for implementer)

1. Register at `developer.kroger.com`, create an app, set grant type to Client Credentials, enable `product.compact` scope.
2. Set `KROGER_CLIENT_ID`, `KROGER_CLIENT_SECRET`, `KROGER_LOCATION_ID` in `.env`.
3. Run `node -e "require('./lib/kroger-client').getAccessToken().then(t => console.log(t.slice(0,20)))"` — should print first 20 chars of a JWT.
4. Run `node -e "require('./lib/kroger-client').krogerGet('/v1/products', {'filter.term':'salmon fillet','filter.locationId':process.env.KROGER_LOCATION_ID,'filter.limit':1}).then(d=>console.log(JSON.stringify(d.data[0],null,2)))"` — should print a product object.
5. Apply migration: `npm run migrate`.
6. Run `node jobs/kroger-price-sync.js` — watch for `synced: N` in output.
7. Verify in DB: `SELECT pe.price, pe.deal, pe.verified_at FROM price_entries pe JOIN stores s ON s.id = pe.store_id WHERE s.slug = 'kroger' ORDER BY pe.verified_at DESC LIMIT 5;` — rows should have a `verified_at` within the last minute.
8. Hit `GET /api/prices/compare/1` (or any ingredient id) — confirm Kroger prices are returned in the response.
