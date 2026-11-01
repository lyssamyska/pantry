import * as cheerio from 'cheerio';
import { checkCompliance, detectProtein } from './compliance';

// ═══════════════════════════════════════════════════════
// Recipe Scraper
// Fetches any URL and extracts schema.org/Recipe JSON-LD
// Works with 95%+ of recipe blogs and food sites
// ═══════════════════════════════════════════════════════

export interface ScrapedRecipe {
  name: string;
  source: 'url' | 'pinterest';
  sourceUrl: string | null;
  protein: string | null;
  totalTimeMinutes: number;
  servings: number;
  ingredients: string[];
  instructions: string[];
  tags: string[];
  compliant: boolean;
  warnings: string[];
  imageUrl: string | null;
  schemaOrgJson: any;
}

// ── Main scraper ──────────────────────────────────────
export async function scrapeRecipeFromUrl(url: string): Promise<ScrapedRecipe | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'MealAgent/1.0 (recipe importer)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(15000), // 15s timeout
    });

    if (!response.ok) return null;

    const html = await response.text();
    return extractRecipeFromHtml(html, url);
  } catch (error) {
    console.error(`Failed to scrape ${url}:`, error);
    return null;
  }
}

// ── Extract recipe from HTML ──────────────────────────
export function extractRecipeFromHtml(html: string, sourceUrl?: string): ScrapedRecipe | null {
  const $ = cheerio.load(html);

  // Strategy 1: Look for JSON-LD script tags (most common)
  const jsonLdScripts = $('script[type="application/ld+json"]');

  for (let i = 0; i < jsonLdScripts.length; i++) {
    try {
      const raw = $(jsonLdScripts[i]).html();
      if (!raw) continue;

      const data = JSON.parse(raw);
      const recipe = findRecipeInJsonLd(data);
      if (recipe) {
        return normalizeRecipe(recipe, sourceUrl);
      }
    } catch {
      // Invalid JSON, try next script tag
    }
  }

  // Strategy 2: Look for microdata (less common but still used)
  const microdataRecipe = $('[itemtype*="schema.org/Recipe"]');
  if (microdataRecipe.length > 0) {
    return extractMicrodataRecipe($, microdataRecipe.first(), sourceUrl);
  }

  return null;
}

// ── Find Recipe in JSON-LD (handles nesting) ──────────
function findRecipeInJsonLd(data: any): any | null {
  if (!data) return null;

  // Direct Recipe object
  if (data['@type'] === 'Recipe') return data;

  // Array of objects
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = findRecipeInJsonLd(item);
      if (found) return found;
    }
  }

  // @graph container (used by Yoast, Rank Math, etc.)
  if (data['@graph'] && Array.isArray(data['@graph'])) {
    for (const item of data['@graph']) {
      if (item['@type'] === 'Recipe') return item;
    }
  }

  // Array @type like ["Recipe", "Thing"]
  if (Array.isArray(data['@type']) && data['@type'].includes('Recipe')) {
    return data;
  }

  return null;
}

// ── Normalize schema.org data to our format ───────────
function normalizeRecipe(data: any, sourceUrl?: string): ScrapedRecipe {
  const ingredients = extractIngredients(data);
  const compliance = checkCompliance(ingredients);

  return {
    name: data.name || 'Untitled Recipe',
    source: 'url',
    sourceUrl: data.url || sourceUrl || null,
    protein: detectProtein(ingredients),
    totalTimeMinutes: parseDuration(data.totalTime || data.cookTime || data.prepTime),
    servings: parseServings(data.recipeYield),
    ingredients,
    instructions: extractInstructions(data.recipeInstructions),
    tags: extractTags(data),
    compliant: compliance.compliant,
    warnings: compliance.warnings,
    imageUrl: extractImage(data.image),
    schemaOrgJson: data,
  };
}

// ── Parse ingredients ─────────────────────────────────
function extractIngredients(data: any): string[] {
  const raw = data.recipeIngredient || data.ingredients || [];
  if (!Array.isArray(raw)) return [String(raw)];
  return raw.map((i: any) => {
    if (typeof i === 'string') return i.trim();
    if (i?.name) return `${i.value || ''} ${i.name}`.trim();
    return String(i);
  }).filter(Boolean);
}

// ── Parse instructions ────────────────────────────────
function extractInstructions(raw: any): string[] {
  if (!raw) return [];
  if (typeof raw === 'string') {
    return raw.split(/\n|(?:\.\s+)/).map(s => s.trim()).filter(Boolean);
  }
  if (Array.isArray(raw)) {
    return raw.flatMap((item: any) => {
      if (typeof item === 'string') return [item.trim()];
      if (item['@type'] === 'HowToStep') return [item.text || item.name || ''];
      if (item['@type'] === 'HowToSection') {
        const steps = item.itemListElement || [];
        return steps.map((s: any) => s.text || s.name || '');
      }
      if (item.text) return [item.text];
      return [String(item)];
    }).filter(Boolean);
  }
  return [];
}

// ── Parse ISO 8601 duration ───────────────────────────
function parseDuration(iso?: string): number {
  if (!iso) return 30;
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 30;
  return (parseInt(match[1] || '0') * 60) + parseInt(match[2] || '0') + Math.ceil(parseInt(match[3] || '0') / 60);
}

// ── Parse servings ────────────────────────────────────
function parseServings(raw: any): number {
  if (!raw) return 4;
  if (typeof raw === 'number') return raw;
  const str = Array.isArray(raw) ? raw[0] : String(raw);
  const match = str.match(/(\d+)/);
  return match ? parseInt(match[1]) : 4;
}

// ── Extract tags ──────────────────────────────────────
function extractTags(data: any): string[] {
  const tags: string[] = [];
  if (data.keywords) {
    const kw = typeof data.keywords === 'string' ? data.keywords.split(',') : data.keywords;
    kw.forEach((k: string) => { if (k.trim()) tags.push(k.trim().toLowerCase()); });
  }
  if (data.recipeCategory) {
    const cats = Array.isArray(data.recipeCategory) ? data.recipeCategory : [data.recipeCategory];
    cats.forEach((c: string) => tags.push(c.toLowerCase()));
  }
  if (data.recipeCuisine) {
    const cuisines = Array.isArray(data.recipeCuisine) ? data.recipeCuisine : [data.recipeCuisine];
    cuisines.forEach((c: string) => tags.push(c.toLowerCase()));
  }
  if (data.suitableForDiet) {
    const diets = Array.isArray(data.suitableForDiet) ? data.suitableForDiet : [data.suitableForDiet];
    diets.forEach((d: string) => { if (d.includes('GlutenFree')) tags.push('gf'); });
  }
  return [...new Set(tags)];
}

// ── Extract image URL ─────────────────────────────────
function extractImage(raw: any): string | null {
  if (!raw) return null;
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) return raw[0]?.url || raw[0] || null;
  if (raw.url) return raw.url;
  return null;
}

// ── Microdata fallback parser ─────────────────────────
function extractMicrodataRecipe($: cheerio.CheerioAPI, el: cheerio.Cheerio, sourceUrl?: string): ScrapedRecipe | null {
  const name = el.find('[itemprop="name"]').first().text().trim();
  const ingredients = el.find('[itemprop="recipeIngredient"], [itemprop="ingredients"]')
    .map((_, e) => $(e).text().trim()).get();

  if (!name || ingredients.length === 0) return null;

  const compliance = checkCompliance(ingredients);

  return {
    name,
    source: 'url',
    sourceUrl: sourceUrl || null,
    protein: detectProtein(ingredients),
    totalTimeMinutes: parseDuration(el.find('[itemprop="totalTime"]').attr('content') || undefined),
    servings: parseServings(el.find('[itemprop="recipeYield"]').text()),
    ingredients,
    instructions: el.find('[itemprop="recipeInstructions"] [itemprop="text"]')
      .map((_, e) => $(e).text().trim()).get(),
    tags: [],
    compliant: compliance.compliant,
    warnings: compliance.warnings,
    imageUrl: el.find('[itemprop="image"]').attr('src') || null,
    schemaOrgJson: null,
  };
}
