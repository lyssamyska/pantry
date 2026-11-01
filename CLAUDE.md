# Pantry — Meal Planning App

## What this app does
Personal meal planning built around Austin grocery prices. Generates a 7-day dinner plan + consolidated grocery list from user preferences (diet, allergies, must-have ingredients, avoided ingredients, budget), subtracting what's already in the pantry/CSA box. Quality sourcing rules built in (grass-fed beef, pastured chicken/turkey, wild-caught fish), plus a dietary compliance checker for gluten-free and sugar-free.

## Stack
Express.js + EJS + PostgreSQL (Neon) + Render. No third-party platform services: no Polsia, no payments, no analytics.

## Running
- Required env: `DATABASE_URL`, `SESSION_SECRET` (at least 32 chars; the server refuses to start otherwise). Nothing else.
- `npm start` runs migrations, then serves on `PORT` (default 3000).
- `npm test` (= `node --test tests/*.js`) — no database needed.
- `npm run set-password -- <email>` sets/resets a password for an existing account (prompts; or set `PANTRY_PASSWORD`). Use it for accounts created back when sign-in was by emailed code.

## Directory map
- `server.js` — app entry, wiring only
- `routes/` — endpoint groups (auth, planner, recipes, recipe-import, bookmarks, my-recipes, discovery, prices, pantry, profile, onboarding, product pages)
- `db/` — database access layer, one file per entity
- `services/` — business logic
  - `meal-planner.js` — rule-based plan + grocery list builder (no LLM calls)
  - `compliance.js` — dietary/sourcing checker (see below)
  - `recipe-importer.js` — URL → recipe extraction
- `lib/` — shared utilities
  - `auth.js` — bcrypt password hashing, register/login
  - `session.js` — HMAC-signed session cookie (`pantry_session`, 30 days)
  - `user-session.js` — `getUserIdFromCookie(req)`, the one way routes read the signed-in user
  - `require-auth.js` — `requireAuth` + `rejectMismatchedUserId` route guards
  - `austin-retailers.js` — supported stores, price selection, `PRICE_ESTIMATE_NOTICE`
  - `seed-recipes.js` — seeded recipe catalog with compliance fixes applied
- `migrations/` — schema/data changes, applied on startup, each runs once (tracked in `_migrations`). Never edit the effect of an applied migration — add a new one.
- `scripts/` — one-off CLI tools (`set-password.js`)
- `views/` — EJS templates (`layout.ejs` is the landing page + sign-in dialog)
- `public/` — static assets
- `tests/` — `node:test` suites
- `reference/` — older Next.js scaffold and API research. Port from it; don't run it.

## Auth
Email + password (ported from `reference/meal-agent-starter/lib/auth.ts`). `POST /auth/register`, `/auth/login`, `/auth/logout`. Passwords: bcryptjs, cost 12, 8–72 chars. Sessions: signed cookie, verified with a timing-safe compare; an unsigned or edited cookie is treated as signed-out. Registering an existing email is refused (old passwordless accounts are claimed via `set-password`, not registration). All `/api/*` routers use `requireAuth`; any `userId` in a body/query must match the session.

## Dietary compliance (`services/compliance.js`)
Ported from the starter's `lib/compliance.ts`. Rules are grouped by the flag they back:
- **gluten rules → `gluten-free`**, **sugar rules → `sugar-free`**, **sourcing rules → every recipe**.
- Never flags "<x>-free", "<x> free", "no <x>", "no added <x>" (e.g. "sugar-free ketchup", "gluten-free flour"); "gluten-free"/"unsweetened" etc. clear the whole category for that line.
- Always compliant: coconut aminos, Siete products, cauliflower rice. Allowed sweeteners: stevia, monk fruit, erythritol, allulose, xylitol.
- Whole-word matching; gluten-free look-alikes (rice noodles, corn tortillas, almond/cassava flour, tamari) are exempt.
- Sourcing: beef → grass-fed; chicken/turkey → pastured (not "free-range"); fish/seafood → wild-caught. Broths and fish sauce are exempt; "steak" on a fish/vegetable line isn't beef.
- `checkCompliance(ingredients)` accepts strings or `{ name, quantity, sourcing_hint }`. `reconcileDietaryFlags()` keeps unverifiable flags (dairy-free, vegetarian…) and recomputes gluten-free/sugar-free.
- Seeded recipes and imported recipes both go through it. Imported recipes' gluten-free/sugar-free flags are recomputed server-side on save — never trusted from the page or browser.
- `tests/compliance.test.js` audits every seeded recipe; it fails if a recipe claims a flag it doesn't meet.

## Recipe import (`services/recipe-importer.js`)
Ported from the starter's `lib/scraper.ts`: JSON-LD (`application/ld+json`, arrays, `@graph`, `mainEntity`, array `@type`) → schema.org microdata → Open Graph/HTML fallback. Returns `compliance` (warnings + earned flags) for the preview. `extractRecipeFromHtml(html, url)` is pure and is what the tests exercise.

## Database
- `users` — email, bcrypt `password_hash`, onboarding prefs (`diet_preferences`, `meal_count_defaults`)
- `recipes` — 51 seeded dinners + user imports (`source_url` set). `dietary_flags` text[]: gluten-free, sugar-free, dairy-free, vegetarian, vegan…
- `meal_plans` — generated plans (user_id, days JSONB, servings, weekly_budget_target)
- `grocery_items` — consolidated shopping list per plan (category, items JSONB)
- `user_bookmarks` — recipe bookmarks (user_id, recipe_id)
- `pantry_items` — what the user already has (pantry + CSA)
- `stores`, `ingredients`, `price_entries` — seeded Austin price list

## Stores and prices
Supported stores: H-E-B (preferred), Whole Foods, Sprouts, Central Market, Barton Springs Market. No Kroger. **Every price is a seeded estimate** (`price_entries.price_is_estimate = true`), not a live feed; Sprouts and Central Market prices are H-E-B's seeded price × a category markup (see migration `1790600200000`). The UI says so via `PRICE_ESTIMATE_NOTICE` (exposed to views as `priceEstimateNotice`) and "Est. ~$" prices.

## External integrations
None required. (`openai`, `nodemailer`, and `domhandler` are still in package.json but unused.)

## Brand identity
- `public/brand/BRAND-GUIDE.md` — full brand guide (readable, team reference)
- `public/brand/brand-guide.css` — complete CSS system (classes, vars, components)
- `public/brand/brand-guide.json` — machine-readable spec (colors, type scale, rules)
- `views/layout.ejs` — production implementation of landing page
- `views/planner.ejs` — production implementation of app UI
- Primary: `#2A4D1E` (Pantry Green). Accent: `#C8561A` (Sienna). Fonts: Fraunces + DM Sans.
- Logo rule: the period after "Pantry" renders in sienna. Never remove the span wrapper.

## Recent changes
- (2026-11-01) Left Polsia: removed the analytics pixel, error forwarding, and payments/paid-access gating; replaced emailed sign-in codes with email + password and a signed session cookie (`SESSION_SECRET`). Added `services/compliance.js` (gluten/sugar/sourcing), a `sugar-free` flag, and fixed seeded recipes (Lamb Flatiron farro → quinoa; soy sauce → coconut aminos in four recipes). Rewrote the recipe importer (working JSON-LD, `@graph`, microdata; fixed `getHost` and duration parsing) with compliance checks on import. Replaced Kroger with Sprouts and Central Market; all prices labeled estimates. Removed the duplicate `/api/planner/seed-recipes` endpoint. Fixed a fresh-database migration failure and the Discover panel query.
- (2026-06-25) Brand Identity: defined Pantry's visual identity — color palette, typography (Fraunces + DM Sans), logo spec, and full CSS component system.
- (2026-06-19) Post-Import Meal Plan Prompt: after saving an imported recipe, offers to slot it into the current plan. /api/recipe-import/add-to-plan, addRecipeToDay/getLatestPlan in db/meal-plans.js.
- (2026-06-16) My Recipes Panel: Recipe Box tab with bookmarked + imported recipes, multi-select, force-include in plan generation (/api/my-recipes/:userId, mustHaveRecipeIds).
- (2026-06-12) Recipe Detail Modal: full recipe view from day cards.
- (2026-06-10) Recipe Bookmarking: user_bookmarks table, /api/bookmarks/toggle, bookmarked recipes weighted higher in plan generation.
- (2026-06-09) Recipe URL Import: /api/recipe-import endpoints.
- (2026-06-04) Meal Plan Generator MVP: recipes, meal_plans, grocery_items, planner UI.
