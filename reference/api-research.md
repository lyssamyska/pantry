# Meal Planning Agent — API & Integration Research

## Summary

Research into APIs for Instacart, Favor, H-E-B, and Sprouts reveals a range of integration options from fully public developer platforms to no public API at all. Here's the practical breakdown for building your meal planning agent in Austin.

---

## 1. Instacart — ✅ Public Developer API Available

**Status:** Best integration path of the four. Instacart has a publicly available Developer Platform (IDP) with REST APIs.

**API Details:**
- **Base URL:** `https://connect.instacart.com/idp/v1/<endpoint>`
- **Dev server:** `https://connect.dev.instacart.tools`
- **Auth:** Bearer token (API key from Instacart dashboard)
- **Format:** REST / JSON

**What you can do:**
- Create shoppable recipe links (map ingredients → products at local retailers)
- Generate shopping lists that link directly into Instacart checkout
- Access Instacart's item catalog (ingredients, nutrition, product attributes)
- Get real-time info on what's on shelves at local retailers (including Sprouts, H-E-B in some markets)
- Affiliate commission on completed orders originating from your app

**What you CAN'T do (as a developer partner):**
- Access Connect Fulfillment APIs (delivery scheduling, order tracking) — retailer partners only
- Directly scrape pricing or deal data — the IDP links users to Instacart-hosted pages for checkout
- Place orders on behalf of users programmatically (users complete checkout on Instacart)

**How to get access:**
1. Sign up at the Instacart Developer Platform portal
2. Get a Development API key immediately
3. Build and test integration
4. Request Production API key (triggers Instacart review)
5. Upon approval, get affiliate program access via Impact.com

**Best use in your agent:** Route all Sprouts and H-E-B online grocery orders through Instacart's API. Generate ingredient lists from your meal plan → create Instacart shopping links → user checks out on Instacart. You can earn affiliate commissions on conversions.

---

## 2. Favor — ⚠️ Partner-Only API (Not Public)

**Status:** Favor has an API, but it's restricted to business partners with a signed agreement. There is no public developer program.

**What exists:**
- A REST API for sending and processing order information between partners and Favor
- API key provided upon signing a partner agreement
- Rate-limited; Favor controls frequency of API calls
- Terms prohibit building competing services or reselling API access

**Restrictions:**
- Must have a formal business agreement with Favor (NeighborFavor Inc.)
- API is exclusively for order processing, not browsing menus or deals
- No public documentation, no developer portal, no self-serve signup
- Cannot be used to build products that compete with Favor's core service

**Workarounds for your agent:**
- **Favor is owned by H-E-B** (acquired 2018), so H-E-B delivery orders often go through Favor in Texas
- You could monitor Favor's app/website for deals manually and input them into your agent
- For programmatic access, the most viable path is going through Instacart (which also delivers from H-E-B in some areas)

**Best use in your agent:** Treat Favor as a "manual input" source. Periodically check the Favor app for deals/promos in Austin and enter them into your agent's deal database. No automated API integration is feasible without a partnership.

---

## 3. H-E-B — ⚠️ No Public API

**Status:** H-E-B has extensive internal APIs powering their digital platform (curbside, delivery, product catalog), but none are publicly available to third-party developers.

**What exists internally:**
- **PALS API:** Real-time store-specific product assortment and availability (internal)
- **Pyxis API:** In-store navigation/sequencing for personal shoppers (internal)
- **openapi.heb.com:** Internal REST endpoints for cart, estimated shipping, etc. (not documented publicly)
- **EDI integration:** For supply chain partners only (purchase orders, invoices, ASNs)
- **H-E-B Digital:** Active engineering team building mobile/web apps, but no external developer program

**What developers have done (unofficial):**
- Community developers have reverse-engineered H-E-B's curbside availability endpoints (checking slot availability by zip code)
- These use undocumented endpoints like H-E-B's cart and store APIs
- This approach is fragile (endpoints change), potentially violates Terms of Use, and H-E-B has not endorsed it

**Workarounds for your agent:**
- **Use Instacart as a proxy** — H-E-B is available on Instacart in Texas markets, so you can use the Instacart Developer Platform to access H-E-B products
- **H-E-B Weekly Ad** — scrape or manually input weekly specials (the digital weekly ad is publicly viewable on heb.com)
- **Favor delivery** — since H-E-B owns Favor, some delivery orders route through Favor's infrastructure
- **H-E-B Curbside/Delivery site (shop.heb.com)** — users can shop directly; your agent could generate a shopping list for manual entry

**Best use in your agent:** Use Instacart's API to access H-E-B products programmatically. Supplement with manual weekly ad data from heb.com for deal scanning. Generate organized shopping lists that users can paste into shop.heb.com if they prefer to order direct.

---

## 4. Sprouts Farmers Market — ⚠️ No Public API

**Status:** Sprouts has no public developer API. All online ordering is powered entirely by Instacart.

**Key facts:**
- Sprouts delivery and curbside is 100% handled by Instacart
- The online store at shop.sprouts.com is an Instacart-powered storefront
- Sprouts uses Instacart's FoodStorm OMS for catering/holiday orders
- EDI integration exists for supply chain vendors, not consumer-facing developers
- Sprouts app has digital coupons, weekly ads, and shopping lists but no API access

**Workarounds for your agent:**
- **Instacart Developer Platform** is your primary integration path — Sprouts products are fully available through Instacart
- **Sprouts Weekly Ad** — publicly available on sprouts.com; can be scraped or manually entered for deal scanning
- **Sprouts Digital Coupons** — visible in the Sprouts app; no API, but could be manually tracked

**Best use in your agent:** All Sprouts ordering goes through Instacart. Use the Instacart Developer Platform API to generate shoppable lists at Sprouts. Monitor sprouts.com weekly ads for deals to feed into your deal scanner.

---

## Recommended Architecture

```
┌─────────────────────────────────────────┐
│          MEAL PLANNING AGENT            │
├─────────────────────────────────────────┤
│                                         │
│  ┌──────────┐   ┌───────────────────┐   │
│  │ Recipe    │   │ Pantry Tracker    │   │
│  │ Sources   │   │ (local DB)        │   │
│  └────┬─────┘   └────────┬──────────┘   │
│       │                  │              │
│       ▼                  ▼              │
│  ┌──────────────────────────────────┐   │
│  │     MEAL PLAN ENGINE             │   │
│  │  • Dietary rules (GF, no sugar)  │   │
│  │  • Protein standards             │   │
│  │  • Use-what-you-have logic       │   │
│  │  • Expiration prioritization     │   │
│  └──────────────┬───────────────────┘   │
│                 │                       │
│                 ▼                       │
│  ┌──────────────────────────────────┐   │
│  │     SHOPPING LIST GENERATOR      │   │
│  └──────────────┬───────────────────┘   │
│                 │                       │
│       ┌─────────┼─────────┐             │
│       ▼         ▼         ▼             │
│  ┌────────┐ ┌────────┐ ┌──────────┐    │
│  │Instacart│ │ Manual │ │Imperfect │    │
│  │  API    │ │ Entry  │ │ Foods    │    │
│  │(Sprouts,│ │(Favor, │ │(schedule │    │
│  │ H-E-B) │ │ deals) │ │ aware)   │    │
│  └────────┘ └────────┘ └──────────┘    │
│                                         │
│  ┌──────────────────────────────────┐   │
│  │     DEAL SCANNER                 │   │
│  │  • Instacart (API)               │   │
│  │  • H-E-B weekly ad (manual/web)  │   │
│  │  • Sprouts weekly ad (manual/web)│   │
│  │  • Favor promos (manual)         │   │
│  │  • Imperfect Foods (email parse) │   │
│  └──────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

## Integration Priority

| Source | Method | Effort | Value |
|--------|--------|--------|-------|
| **Instacart** | Official API (IDP) | Medium — apply for key, build integration | **High** — covers Sprouts + H-E-B ordering |
| **Imperfect Foods** | Email parsing + manual schedule | Low | **High** — weekly staples, good prices |
| **H-E-B** | Via Instacart API + manual weekly ad | Low–Med | **High** — primary local grocer |
| **Sprouts** | Via Instacart API + manual weekly ad | Low | **Medium** — specialty/organic items |
| **Favor** | Manual only (no public API) | Low | **Low** — prepared food delivery, limited use |
| **ButcherBox** | Manual / email parsing | Low | **High** — grass-fed beef, free-range chicken |
| **Vital Choice** | Manual / email parsing | Low | **High** — wild-caught fish |

## Next Steps

1. **Apply for Instacart Developer Platform access** — this is the single highest-leverage integration, covering both Sprouts and H-E-B product catalogs and ordering
2. **Build a deal ingestion pipeline** for H-E-B and Sprouts weekly ads (web scraping or manual entry)
3. **Set up Imperfect Foods schedule tracking** with email parsing for order reminders and deal alerts
4. **Add ButcherBox and Vital Choice** as manual subscription sources for compliant proteins
5. **Treat Favor as manual-only** unless you pursue a formal business partnership
