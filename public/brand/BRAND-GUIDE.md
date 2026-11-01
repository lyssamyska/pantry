# Pantry Brand Identity Guide
**Version 1.0 — June 2026**

---

## Brand Personality

Pantry is **editorial, sharp, direct, and warm without being soft.** We're for Austin adults who cook regularly, care about sourcing but also care about their budget. We don't use fluff language and we don't talk down to people.

> "Meal planning that counts."
> Not "revolutionary AI-powered meal planning that transforms your relationship with food."

---

## Logo

**Wordmark:** `Pantry` — rendered in Fraunces serif, green (#2A4D1E), weight 700.
**Required element:** a sienna period after the word — `<span>Pantry</span><span style="color:#C8561A">.</span>`

### CSS
```css
.pantry-logo {
  font-family: 'Fraunces', serif;
  font-weight: 700;
  color: #2A4D1E;
  letter-spacing: -0.02em;
}
.pantry-logo span { color: #C8561A; }  /* The period */
```

### Lockup Sizes
| Context | Font Size | Weight | Notes |
|---------|-----------|--------|-------|
| Nav | 1.4rem | 700 | |
| Footer | 1rem | 700 | Opacity 0.3 |
| App icon | 1.6rem | 800 | |

### Don't Do These
- Pantry in all caps
- Pantry without the sienna period
- Sienna period rendered in green
- Substituting another serif (Lora, Playfair, etc.)

---

## Color Palette

### Core Palette

| Name | Hex | Use |
|------|-----|-----|
| **Pantry Green** | `#2A4D1E` | Primary — nav, CTAs, verified sourcing badges |
| Green Light | `#3D6B2D` | Hover state for green elements |
| **Pale Green** | `#EDF4E3` | Badge backgrounds, savings highlights, tag fills |
| **Sienna** | `#C8561A` | The logo period, deal highlights, section tags, star ratings, accent badges |
| Sienna Light | `#E07040` | Sienna hover states |
| **Near Black** | `#1A1A1A` | Headings, body text, dark section backgrounds |
| Warm Gray | `#5A5449` | Secondary text, descriptions |
| Light Gray | `#8C8377` | Tertiary / meta / placeholder text |
| Divider | `#EDEDEA` | Borders, separators |
| White | `#FFFFFF` | Cards, inputs, primary backgrounds |
| Warm White | `#FAFAF8` | Page background |
| Cool White | `#F8F8F6` | Alternating section backgrounds |

### Semantic Colors

| Usage | Background | Text | Hex Notes |
|-------|-----------|------|-----------|
| Sourced badge | `#EDF4E3` | `#2A4D1E` | Green pale bg, green text |
| Farm-direct badge | `#FDF3E8` | `#9A5220` | Warm tan bg, brown text |
| Deal card header (H-E-B) | Gradient `#1A5EA8 → #0D3F7A` | white | Blue brand |
| Deal card header (Farmers) | Gradient `#2A4D1E → #1A3510` | white | Green brand |
| Deal card header (CSA) | Gradient `#7A4A1E → #5C3412` | white | Brown brand |

### Dark Surfaces
- Footer: `#141412`
- Stat strip: `#1A1A1A` with `rgba(255,255,255,0.08)` dividers
- Closing CTA: `#1A1A1A`
- Deal card (hero): `linear-gradient(135deg, #1A1A18 0%, #2A2A26 100%)`

---

## Typography

### Font Stack
- **Display / Headings:** Fraunces (Google Fonts)
- **Body / UI:** DM Sans (Google Fonts)

```
https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..900;1,9..144,300..900&family=DM+Sans:ital,wght@0,300..700;1,300..700&display=swap
```

### Never Use
- Inter, Roboto, Arial
- System-ui defaults
- Playfair Display, Lora, or other serifs (for display text)

### Type Scale

| Element | Font | Size | Weight | Tracking | Line Height | Notes |
|---------|------|------|--------|----------|-------------|-------|
| Hero H1 | Fraunces | `clamp(3rem, 5.5vw, 5.5rem)` | 800 | -0.03em | 1.05 | |
| Section H2 | Fraunces | `clamp(2rem, 3.5vw, 3rem)` | 700 | -0.02em | 1.15 | |
| Card H3 | Fraunces | 1.2rem | 700 | — | — | |
| Body | DM Sans | 1rem | 400 | — | 1.65 | |
| Small / Labels | DM Sans | 0.875rem | 500 | — | — | |
| Micro badges | DM Sans | 0.7–0.75rem | 600 | 0.04–0.1em | — | Always uppercase |
| Section tags | DM Sans | 0.72rem | 700 | 0.1em | — | Always uppercase, sienna |

### Italic Usage
Use Fraunces italic for emphasis within H1/H2 — the green italic `em` in section titles. **Not for body copy.**

```css
.hero h1 em {
  font-style: italic;
  color: var(--green);
}
```

---

## Iconography

Custom inline SVG only. No icon libraries (Heroicons, Phosphor, etc.).

### Sourcing Icons
| Icon | Use | Color |
|------|-----|-------|
| Star | Deal badges, recipe bookmarking | Sienna `#C8561A` |
| Check-circle | Sourcing verification, standard checkmarks | Green `#2A4D1E` |
| Herb | Farm-direct indicators | Warm terracotta |
| Egg | Pasture-raised, farm-direct | Gold/tan |
| Tomato | Fresh/seasonal indicators | Red-green tones |
| Fish | Wild-caught indicators | Teal/blue |

### Store Icons
Custom geometric SVGs for market/store branding. Use dark gradient backgrounds matching the store's brand colors.

---

## Imagery

### Photo Style
**Editorial flatlay, warm morning light, wooden table surfaces.** Ingredients + recipe cards + ledger. Rich, tactile, appetizing. Austin market aesthetic.

### Hero Image Spec
- Warm morning light, wooden kitchen table
- Recipe cards, handwritten ledger, Pantry brand jar with dry goods
- Heirloom tomatoes, farm eggs, fresh herbs
- Rich, tactile, appetizing — not a stock photo look

### Backgrounds
- Warm white `#FAFAF8` — general surfaces
- Pale green `#EDF4E3` — sourcing/quality sections
- Near black `#1A1A1A` — dramatic contrast sections (footer, closing)

---

## App Surface (Planner UI)

### Layout
Three-column app layout:
- Left: 110px sidebar (day + meal quick-view)
- Center: main content (meal cards, recipe list)
- Right: 100px grocery list panel

### Sidebar
- Background: `#F8F8F6`
- Active item: `#E8EFDE` (pale green tint)
- Day label: uppercase, green, small
- Tags: green-pale for sourced, `#FDF3E8` for farm-direct

### Meal Card
- 36px icon column + title/meta + price column
- Day: small uppercase green label above icon
- Title: Fraunces serif, 0.78rem, weight 700
- Tags: small pill badges
- Price: Fraunces, large, green

### Recipe Card (My Recipes panel)
- Card with border, hover shadow
- Star button accessible in modal and card
- Dietary tags, prep/cook time

### Grocery List
- Items grouped by section (Produce, Meat, Dairy, etc.)
- Source tag: uppercase badge (Farmers Market, H-E-B, CSA)
- Price: Fraunces, green
- Dashed dividers between items

---

## Web Landing Sections

| Section | Background | Layout |
|---------|-----------|--------|
| Hero | white | 2-col (text + app window illustration) |
| Stats Strip | near-black | 4-col grid |
| How It Works | white | 3-col steps |
| Market Intelligence | cool-white | 3-col deal cards |
| The Pantry Standard | white | 2-col (text + image grid) |
| Social Proof | white | 3-col testimonials |
| FAQ | cool-white | single-col accordion |
| Closing CTA | near-black | centered |
| Footer | `#141412` | minimal |

---

## Motion & Interaction

| Interaction | Behavior |
|------------|---------|
| Card hover | `translateY(-3px to -4px)` + shadow lift, 0.25s ease |
| Button hover | Background shift, 0.2s ease |
| Nav links | Color shift to green on hover, 0.2s |
| Floating hero cards | Subtle 4–5s ease-in-out infinite float animation |
| App window | Slight rotation (-1.5deg) on landing page illustration |

### Don't
- Snap animations
- Bouncy spring animations on structural UI
- Page transitions within the app (keep it fast)

---

## CSS Custom Properties

Reference `brand-guide.css` for full implementation. Key vars:

```css
--p-green:       #2A4D1E;
--p-green-light: #3D6B2D;
--p-green-pale:  #EDF4E3;
--p-sienna:      #C8561A;
--p-sienna-light:#E07040;
--p-near-black:  #1A1A1A;
--p-warm-gray:   #5A5449;
--p-light-gray:   #8C8377;
--p-divider:      #EDEDEA;
--p-white-warm:  #FAFAF8;
--p-white-cool:  #F8F8F6;
```

---

## Don'ts

1. Don't use sienna as the primary brand color — green is primary
2. Don't replace Fraunces with a different serif
3. Don't use generic stock food photography
4. Don't remove the sienna period from the logo wordmark
5. Don't use more than 3 brand colors in a single composition
6. Don't put ultra-processed food imagery near Pantry Standard sections
7. Don't use `#2A4D1E` for text on white — use `#1A1A1A`

---

## Assets

| File | Purpose |
|------|---------|
| `public/brand/brand-guide.json` | Machine-readable spec (CSS vars, color hex, type scale) |
| `public/brand/brand-guide.css` | Full CSS system — import in any surface |
| `public/brand/BRAND-GUIDE.md` | This document — team reference |
| `views/layout.ejs` | Production implementation of the landing page |
| `views/planner.ejs` | Production implementation of the app UI |