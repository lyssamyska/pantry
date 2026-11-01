# Pantry — Meal Planning App

## What this app does
Smart meal planning built around Austin market deals. Generates a 7-day dinner plan + consolidated grocery list from user preferences (diet, allergies, macro targets, must-have ingredients). Quality sourcing rules built in (grass-fed beef, pastured chicken, wild-caught fish).

## Stack
Express.js + EJS + Neon PostgreSQL + Render

## Directory map
- `server.js` — app entry, wiring only
- `routes/` — API endpoint groups (planner, recipes, etc.)
- `db/` — database access layer, one file per entity
- `services/` — business logic (meal planning algorithm)
- `migrations/` — schema changes, applied on deploy
- `views/` — EJS templates (layout.ejs is the main landing page)
- `public/` — static assets
- `lib/` — shared utilities

## Database
- `users` — subscription + auth (synced by Polsia)
- `recipes` — 50 seeded dinner recipes (prep_time, protein_type, dietary flags, sourcing_standard)
- `meal_plans` — generated plans (user_id, plan_json, created_at)
- `grocery_items` — consolidated shopping list (plan_id, items_json, category)
- `user_bookmarks` — persisted recipe bookmarks (user_id, recipe_id, created_at)

## External integrations
- OpenAI via `openai` npm package (for meal plan generation)
- Stripe via Polsia MCP (future subscription payments)
- Polsia Auth — OTP (one-time passcode) via polsia.com/auth/otp/request

## Brand identity
- `public/brand/BRAND-GUIDE.md` — full brand guide (readable, team reference)
- `public/brand/brand-guide.css` — complete CSS system (classes, vars, components)
- `public/brand/brand-guide.json` — machine-readable spec (colors, type scale, rules)
- `views/layout.ejs` — production implementation of landing page
- `views/planner.ejs` — production implementation of app UI
- Primary: `#2A4D1E` (Pantry Green). Accent: `#C8561A` (Sienna). Fonts: Fraunces + DM Sans.
- Logo rule: the period after "Pantry" renders in sienna. Never remove the span wrapper.

## Recent changes
- (2026-06-25) Brand Identity: defined Pantry's visual identity — color palette, typography (Fraunces + DM Sans), logo spec, and full CSS component system. Delivered as brand-guide.md (readable), brand-guide.css (CSS classes/vars), and brand-guide.json (machine-readable). Updated CLAUDE.md with brand section.
- (2026-06-19) Post-Import Meal Plan Prompt: after saving an imported recipe, shows "Add to this week's meal plan?" Yes/No prompt. Yes → slots into the next available day in the current plan (or creates a new plan if none exists). /api/recipe-import/add-to-plan endpoint, addRecipeToDay/getLatestPlan in db/meal-plans.js.
- (2026-06-16) My Recipes Panel: Recipe Box tab in planner with bookmarked + imported recipe pool, multi-select, force-include in plan generation. New /api/my-recipes/:userId endpoint, mustHaveRecipeIds param in plan generation.
- (2026-06-12) Recipe Detail Modal: clickable day cards open modal with full recipe (ingredients with sourcing hints, step-by-step instructions, dietary tags, prep/cook time), star button accessible in modal
- (2026-06-10) Recipe Bookmarking: user_bookmarks table, star button on day cards, /api/bookmarks/toggle, bookmarked recipes weighted higher in meal plan generation
- (2026-06-09) Recipe URL Import: /api/recipe-import endpoints, schema.org/OG/HTML fallback parsing, Import from URL UI on planner
- (2026-06-04) Meal Plan Generator MVP: recipes table, meal_plans, grocery_items, /generate-plan endpoint, planner UI