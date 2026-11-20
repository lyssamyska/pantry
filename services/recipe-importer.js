// Recipe URL importer: fetches a page and extracts structured recipe data.
// Extraction order (ported from reference/meal-agent-starter/lib/scraper.ts):
//   1. schema.org JSON-LD   — <script type="application/ld+json">, including
//                              arrays, @graph containers (Yoast, Rank Math)
//                              and array @type like ["Recipe", "Thing"]
//   2. schema.org microdata — [itemtype*="schema.org/Recipe"]
//   3. Open Graph / HTML    — best-effort title, image, itemprop ingredients
// Every result is run through services/compliance.js.
// Does NOT save to DB — caller handles persistence.
const { parseDocument } = require('htmlparser2');
const du = require('domutils');
const { checkCompliance, detectProtein, reconcileDietaryFlags } = require('./compliance');

function getHost(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

// ── Small text helpers ────────────────────────────────
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', frac12: '½', frac14: '¼', frac34: '¾', deg: '°', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

function decodeEntities(text) {
  return String(text).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (match, code) => {
    if (code[0] === '#') {
      const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}

function cleanText(value) {
  if (value == null) return '';
  return decodeEntities(String(value).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').replace(/ ([.,;:!?)])/g, '$1').trim();
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function parseIsoDuration(duration) {
  if (!duration || typeof duration !== 'string') return 0;
  const match = duration.trim().match(/^P(?:(\d+)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
  if (!match) return 0;
  const [, days, hours, minutes, seconds] = match.map((part) => Number(part || 0));
  return Math.round(days * 1440 + hours * 60 + minutes + seconds / 60);
}

function parseServings(raw) {
  const first = asArray(raw).map((v) => (typeof v === 'object' && v ? v.value ?? v.name : v)).find((v) => v != null && v !== '');
  if (first == null) return '';
  return cleanText(first);
}

// ── JSON-LD ───────────────────────────────────────────
function hasRecipeType(node) {
  return asArray(node && node['@type']).some((type) => /(?:^|[/:])Recipe$/i.test(String(type)));
}

// Recursively finds a Recipe in parsed JSON-LD: direct objects, arrays,
// @graph containers, and mainEntity wrappers.
function findRecipeInJsonLd(data, depth = 0) {
  if (!data || typeof data !== 'object' || depth > 8) return null;
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = findRecipeInJsonLd(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (hasRecipeType(data)) return data;
  for (const key of ['@graph', 'mainEntity', 'mainEntityOfPage']) {
    const found = findRecipeInJsonLd(data[key], depth + 1);
    if (found) return found;
  }
  return null;
}

function parseJsonLdBlock(raw) {
  const text = String(raw || '')
    .replace(/^\s*<!--/, '').replace(/-->\s*$/, '')
    .replace(/^\s*\/\/\s*<!\[CDATA\[/, '').replace(/\/\/\s*\]\]>\s*$/, '')
    .trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // Some sites leave raw newlines/tabs inside strings.
    try { return JSON.parse(text.replace(/[\u0000-\u001f]+/g, ' ')); } catch { return null; }
  }
}

function findJsonLdRecipe(doc) {
  const scripts = du.findAll(
    (el) => el.name === 'script' && /application\/ld\+json/i.test(du.getAttributeValue(el, 'type') || ''),
    doc.children
  );
  for (const script of scripts) {
    const recipe = findRecipeInJsonLd(parseJsonLdBlock(du.textContent(script)));
    if (recipe) return recipe;
  }
  return null;
}

function extractIngredients(raw) {
  return asArray(raw).map((item) => {
    if (typeof item === 'string') return cleanText(item);
    if (item && typeof item === 'object') return cleanText(item.text || `${item.value || ''} ${item.name || ''}`);
    return cleanText(item);
  }).filter(Boolean);
}

function extractInstructions(raw) {
  if (!raw) return [];
  if (typeof raw === 'string') {
    const text = decodeEntities(raw);
    const lines = text.split(/<\/?(?:p|li|br)\b[^>]*>|\n+/i).map(cleanText).filter(Boolean);
    return lines.length > 1 ? lines : cleanText(text).split(/(?<=\.)\s+(?=[A-Z])/).filter(Boolean);
  }
  return asArray(raw).flatMap((item) => {
    if (typeof item === 'string') return [cleanText(item)];
    if (!item || typeof item !== 'object') return [];
    if (hasType(item, 'HowToSection') || (item.itemListElement && !item.text)) return extractInstructions(item.itemListElement);
    return [cleanText(item.text || item.name || '')];
  }).filter(Boolean);
}

function hasType(node, type) {
  return asArray(node && node['@type']).some((t) => String(t).endsWith(type));
}

function extractImage(raw) {
  for (const item of asArray(raw)) {
    if (typeof item === 'string' && item) return item;
    if (item && typeof item === 'object' && (item.url || item.contentUrl)) return item.url || item.contentUrl;
  }
  return '';
}

function extractTags(data) {
  const tags = [];
  const keywords = typeof data.keywords === 'string' ? data.keywords.split(',') : asArray(data.keywords);
  for (const value of [...keywords, ...asArray(data.recipeCategory), ...asArray(data.recipeCuisine)]) {
    const tag = cleanText(value).toLowerCase();
    if (tag) tags.push(tag);
  }
  for (const diet of asArray(data.suitableForDiet)) {
    const match = String(diet).match(/([A-Za-z]+)Diet$/);
    if (match) tags.push(match[1].replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase());
  }
  return [...new Set(tags)];
}

// ── Microdata ─────────────────────────────────────────
function findMicrodataRecipe(doc) {
  return du.findOne(
    (el) => /schema\.org\/Recipe/i.test(du.getAttributeValue(el, 'itemtype') || ''),
    doc.children,
    true
  );
}

// Finds itemprop elements under root without descending into nested
// itemscopes (so an author's "name" isn't mistaken for the recipe's).
function itemprops(root, ...names) {
  const wanted = new Set(names);
  const found = [];
  const walk = (nodes) => {
    for (const node of nodes || []) {
      if (node.type !== 'tag' && node.type !== 'script' && node.type !== 'style') continue;
      const props = (du.getAttributeValue(node, 'itemprop') || '').split(/\s+/);
      if (props.some((name) => wanted.has(name))) found.push(node);
      if (du.hasAttrib(node, 'itemscope')) continue;
      walk(node.children);
    }
  };
  walk(root.children);
  return found;
}

function propValue(el) {
  if (!el) return '';
  for (const attr of ['content', 'datetime', 'src', 'href']) {
    const value = du.getAttributeValue(el, attr);
    if (value) return value;
  }
  return cleanText(du.textContent(el));
}

function microdataToSchema(root) {
  const first = (...names) => propValue(itemprops(root, ...names)[0]);
  const instructionEls = itemprops(root, 'recipeInstructions');
  const instructions = instructionEls.flatMap((el) => {
    const steps = itemprops(el, 'text');
    if (steps.length) return steps.map((s) => cleanText(du.textContent(s)));
    const items = du.findAll((child) => child.name === 'li', el.children || []);
    if (items.length) return items.map((li) => cleanText(du.textContent(li)));
    return [cleanText(du.textContent(el))];
  });
  return {
    name: first('name'),
    description: first('description'),
    recipeIngredient: itemprops(root, 'recipeIngredient', 'ingredients').map((el) => cleanText(du.textContent(el))),
    recipeInstructions: instructions,
    prepTime: first('prepTime'),
    cookTime: first('cookTime'),
    totalTime: first('totalTime'),
    recipeYield: first('recipeYield'),
    image: first('image'),
    keywords: first('keywords'),
    recipeCategory: first('recipeCategory'),
  };
}

// ── Normalize to Pantry's shape ───────────────────────
function inferProteinType(tags, ingredients) {
  const text = tags.join(' ');
  if (/vegan|vegetarian|tofu/.test(text)) return 'vegetarian';
  if (/beef|steak|ribeye|tenderloin/.test(text)) return 'beef';
  if (/chicken|poultry/.test(text)) return 'chicken';
  if (/pork|ham|bacon/.test(text)) return 'pork';
  if (/salmon|fish|seafood|tuna|shrimp|lobster/.test(text)) return 'fish';
  return detectProtein(ingredients) || '';
}

function inferUnverifiableFlags(tags) {
  const text = tags.join(' ');
  const flags = [];
  if (/dairy[-\s]?free|vegan/.test(text)) flags.push('dairy-free');
  if (/vegan/.test(text)) flags.push('vegan');
  else if (/vegetarian/.test(text)) flags.push('vegetarian');
  return flags;
}

// Gluten-free / sugar-free are never taken from the page's keywords — only
// from what the ingredient list actually passes.
function withCompliance(recipe) {
  const compliance = checkCompliance(recipe.ingredients);
  return {
    ...recipe,
    dietary_flags: reconcileDietaryFlags(recipe.dietary_flags, recipe.ingredients),
    compliance: {
      compliant: compliance.compliant,
      glutenFree: compliance.glutenFree,
      sugarFree: compliance.sugarFree,
      sourcingOk: compliance.sourcingOk,
      warnings: compliance.warnings,
    },
  };
}

function normalizeSchemaRecipe(data, sourceUrl, parseQuality) {
  const ingredients = extractIngredients(data.recipeIngredient || data.ingredients);
  const tags = extractTags(data);
  return withCompliance({
    name: cleanText(data.name) || 'Imported Recipe',
    description: cleanText(data.description),
    prep_time_minutes: parseIsoDuration(data.prepTime),
    cook_time_minutes: parseIsoDuration(data.cookTime),
    total_time_minutes: parseIsoDuration(data.totalTime),
    protein_type: inferProteinType(tags, ingredients),
    dietary_flags: inferUnverifiableFlags(tags),
    servings: parseServings(data.recipeYield),
    image_url: extractImage(data.image),
    ingredients,
    instructions: extractInstructions(data.recipeInstructions),
    source_standard: false,
    tags,
    source_url: (typeof data.url === 'string' && /^https?:/i.test(data.url) ? data.url : null) || sourceUrl || null,
    parse_quality: parseQuality,
  });
}

// ── Open Graph / HTML fallback ────────────────────────
function metaContent(doc, key) {
  const el = du.findOne((node) => node.name === 'meta' &&
    [du.getAttributeValue(node, 'property'), du.getAttributeValue(node, 'name')].includes(key), doc.children, true);
  return el ? cleanText(du.getAttributeValue(el, 'content')) : '';
}

function htmlFallback(doc, sourceUrl) {
  const h1 = du.findOne((el) => el.name === 'h1', doc.children, true);
  const name = metaContent(doc, 'og:title') || (h1 ? cleanText(du.textContent(h1)) : '');
  const ingredients = itemprops(doc, 'recipeIngredient', 'ingredients').map((el) => cleanText(du.textContent(el))).filter(Boolean);
  const instructions = itemprops(doc, 'recipeInstructions').map((el) => cleanText(du.textContent(el))).filter(Boolean);
  if (!name && ingredients.length === 0) return null;
  return withCompliance({
    name: name || 'Imported Recipe',
    description: metaContent(doc, 'og:description') || metaContent(doc, 'description'),
    prep_time_minutes: 0,
    cook_time_minutes: 0,
    total_time_minutes: 0,
    protein_type: detectProtein(ingredients) || '',
    dietary_flags: [],
    servings: '',
    image_url: metaContent(doc, 'og:image'),
    ingredients,
    instructions,
    source_standard: false,
    tags: [],
    source_url: sourceUrl || null,
    parse_quality: name && ingredients.length > 0 ? 'full' : 'partial',
  });
}

// Pure extraction — no network. Returns null when nothing recipe-like is found.
function extractRecipeFromHtml(html, sourceUrl) {
  const doc = parseDocument(String(html || ''), { decodeEntities: true });

  const jsonLd = findJsonLdRecipe(doc);
  if (jsonLd) {
    const recipe = normalizeSchemaRecipe(jsonLd, sourceUrl, 'schema');
    if (recipe.ingredients.length) return recipe;
  }

  const microdataRoot = findMicrodataRecipe(doc);
  if (microdataRoot) {
    const recipe = normalizeSchemaRecipe(microdataToSchema(microdataRoot), sourceUrl, 'microdata');
    if (recipe.name !== 'Imported Recipe' && recipe.ingredients.length) return recipe;
  }

  return htmlFallback(doc, sourceUrl);
}

async function importRecipeFromUrl(url, { fetchImpl = fetch } = {}) {
  if (!url || !/^https?:\/\//i.test(url)) throw new Error('Invalid URL — must start with http');

  let html;
  try {
    const res = await fetchImpl(url, {
      signal: AbortSignal.timeout(15000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    });
    if (!res.ok) throw new Error(`Site returned HTTP ${res.status}`);
    html = await res.text();
  } catch (err) {
    if (err.name === 'AbortError' || err.name === 'TimeoutError') {
      throw new Error('Request timed out — the site may be blocking automated access. Try entering the recipe manually.');
    }
    throw new Error(`Could not reach the site: ${err.message}`);
  }

  if (!html || html.length < 500) throw new Error('Site returned an empty or invalid page');

  const recipe = extractRecipeFromHtml(html, url);
  if (!recipe) {
    throw new Error('Could not find recipe data on this page. The site may block scraping — try entering the recipe manually.');
  }
  return { ...recipe, source_host: getHost(url) };
}

module.exports = {
  importRecipeFromUrl,
  extractRecipeFromHtml,
  findRecipeInJsonLd,
  parseIsoDuration,
  getHost,
};
