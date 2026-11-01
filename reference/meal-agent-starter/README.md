# Meal Agent 🥩🥬

**Smart meal planning for gluten-free, sugar-free diets with strict protein sourcing.**

Built for [lyssamyskazotlen.com](https://lyssamyskazotlen.com) — deployed as a Next.js app on a subdomain (`meal.lyssamyskazotlen.com`).

## What It Does

- **Recipe import** from Pinterest boards, any recipe URL, or JSON-LD paste
- **Dietary compliance engine** — auto-scans every recipe for gluten, sugar, and verifies protein sourcing (grass-fed beef, free-range chicken, wild-caught fish)
- **Weekly meal planner** with drag-and-drop
- **Pantry tracker** with expiration alerts — agent prioritizes recipes using expiring items
- **Deal scanner** across Instacart (Sprouts + H-E-B), Imperfect Foods, Favor, and more
- **Smart sourcing** — recommends which store to buy each item from based on price

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15 (App Router) |
| Database | Your existing WordPress MySQL |
| Auth | Email/password with JWT + httpOnly cookies |
| Recipe scraping | Cheerio + schema.org/Recipe JSON-LD extraction |
| Pinterest | Official API v5 (OAuth 2.0) |
| Grocery ordering | Instacart Developer Platform |
| Deployment | Vercel (recommended) |

## Quick Start

```bash
# 1. Clone and install
git clone <your-repo>
cd meal-agent
npm install

# 2. Configure environment
cp .env.example .env.local
# Edit .env.local with your WordPress DB credentials + JWT secret

# 3. Create database tables
npm run db:setup

# 4. Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Project Structure

```
meal-agent/
├── app/
│   ├── api/
│   │   ├── auth/
│   │   │   ├── register/route.ts    POST /api/auth/register
│   │   │   ├── login/route.ts       POST /api/auth/login
│   │   │   └── me/route.ts          GET|DELETE /api/auth/me
│   │   ├── recipes/
│   │   │   ├── route.ts             GET|POST|DELETE /api/recipes
│   │   │   ├── import-url/route.ts  POST /api/recipes/import-url
│   │   │   └── import-pinterest/    POST /api/recipes/import-pinterest
│   │   ├── pantry/route.ts          GET|POST|DELETE /api/pantry
│   │   ├── meal-plan/route.ts       GET|POST|DELETE /api/meal-plan
│   │   ├── deals/route.ts           GET /api/deals
│   │   └── compliance/route.ts      POST /api/compliance/check
│   ├── meal-agent/                  Main app UI (client component)
│   ├── auth/login/                  Login page
│   ├── auth/register/               Register page
│   ├── layout.tsx                   Root layout
│   └── page.tsx                     Redirect → /meal-agent or /auth/login
├── lib/
│   ├── db.ts                        WordPress MySQL connection + helpers
│   ├── auth.ts                      JWT auth (register, login, middleware)
│   ├── compliance.ts                Dietary rules engine
│   ├── scraper.ts                   schema.org/Recipe extractor (Cheerio)
│   └── pinterest.ts                 Pinterest OAuth + board/pin API
├── db/
│   └── setup.js                     Creates wp_ma_* tables in your WP database
├── .env.example                     Environment variables template
├── package.json
├── next.config.js
└── tsconfig.json
```

## Database Tables

All tables are prefixed with `wp_ma_` (WordPress meal agent) to avoid conflicts with your existing WordPress tables.

| Table | Purpose |
|-------|---------|
| `wp_ma_users` | Email/password accounts (separate from WP users) |
| `wp_ma_recipes` | Recipe library with compliance status |
| `wp_ma_pantry` | Pantry items with expiration tracking |
| `wp_ma_meal_plans` | Weekly meal assignments |
| `wp_ma_deals` | Cached deals from various sources |
| `wp_ma_pinterest_tokens` | Pinterest OAuth tokens per user |

## API Endpoints

### Auth
- `POST /api/auth/register` — `{ email, password, displayName }`
- `POST /api/auth/login` — `{ email, password }`
- `GET /api/auth/me` — Get current user
- `DELETE /api/auth/me` — Logout

### Recipes
- `GET /api/recipes` — List recipes (`?compliant=true`, `?q=search`)
- `POST /api/recipes` — Create manual recipe
- `DELETE /api/recipes?id=123` — Delete recipe
- `POST /api/recipes/import-url` — `{ url, saveImmediately }`
- `POST /api/recipes/import-pinterest` — `{ boardId, saveCompliant }`

### Pantry
- `GET /api/pantry` — List pantry items
- `POST /api/pantry` — Add item `{ name, quantity, category, expiresAt }`
- `DELETE /api/pantry?id=123` — Remove item

### Meal Plan
- `GET /api/meal-plan?week=2026-03-09` — Get week's plan
- `POST /api/meal-plan` — `{ weekStart, dayOfWeek, meal, recipeId }`
- `DELETE /api/meal-plan?week=...&day=0&meal=Lunch` — Remove assignment

### Compliance
- `POST /api/compliance` — `{ ingredients: [...] }` → `{ compliant, warnings }`

## Deployment to Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel --prod

# Set environment variables in Vercel dashboard:
# WORDPRESS_DB_HOST, WORDPRESS_DB_PORT, WORDPRESS_DB_NAME,
# WORDPRESS_DB_USER, WORDPRESS_DB_PASSWORD, WORDPRESS_TABLE_PREFIX,
# JWT_SECRET, PINTEREST_CLIENT_ID, PINTEREST_CLIENT_SECRET, etc.
```

### DNS Setup
Add a CNAME record for your subdomain:
```
meal.lyssamyskazotlen.com → cname.vercel-dns.com
```

### Important: Database Access from Vercel
Your WordPress MySQL database needs to be accessible from Vercel's servers. Options:
1. **PlanetScale/Railway MySQL** — migrate the meal agent tables to a cloud MySQL (easiest)
2. **SSH tunnel** — if your WP host allows it
3. **WP host with external access** — some managed WP hosts (like Kinsta, Cloudways) allow external MySQL connections
4. **Keep WP DB local, add a cloud replica** for just the `wp_ma_*` tables

## Next Steps

- [ ] Build the React UI (copy from meal-agent-v2.jsx, wire up API calls)
- [ ] Apply for Instacart Developer Platform access
- [ ] Apply for Pinterest Developer Platform access
- [ ] Set up deal scanning cron job
- [ ] Add Imperfect Foods email parsing
- [ ] Add shopping list generation → Instacart checkout link
