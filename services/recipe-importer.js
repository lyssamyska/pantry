// Recipe URL importer: fetches a page, extracts structured recipe data.
// Priority: schema.org JSON-LD → Open Graph meta → HTML structure fallback.
// Does NOT save to DB — caller handles persistence.
const { parseDocument } = require('htmlparser2');
const dh = require('domhandler');
const du = require('domutils');

// Site-specific selectors for HTML fallback
const SITE_SELECTORS = {
  'nytimes.com': { title: 'h1[class*="recipe-title"], [itemprop="name"]', ingredients: '[itemprop="recipeIngredient"]', instructions: '[itemprop="recipeInstructions"]', image: '[itemprop="image"]' },
  'allrecipes.com': { title: 'h1[class*="title"]', ingredients: '[itemprop="recipeIngredient"]', instructions: '[itemprop="recipeInstructions"]', image: '[itemprop="image"]' },
  'seriouseats.com': { title: '.recipe-header h1', ingredients: '.ingredient-list li', instructions: '.recipe-steps li', image: '.recipe-header img' },
  'simplyrecipes.com': { title: '.recipe-header h1', ingredients: '.ingredient-list li', instructions: '.recipe-instructions li', image: '.recipe-header img' },
  'foodnetwork.com': { title: '.RecipeTitle', ingredients: '.IngredientLine li', instructions: '.Instructions li', image: '.RecipeImage img' },
};
const GENERIC_SELECTORS = {
  title: 'h1[class*="recipe"], h1[class*="title"], h1',
  ingredients: '[itemprop="recipeIngredient"]',
  instructions: '[itemprop="recipeInstructions"], .instruction, .recipe-step',
  image: '[itemprop="image"], .recipe-image img, article img',
};

function getHost(url) {
  try { return new URL(url).hostname.replace(/^www\//, ''); } catch { return ''; }
}

function isRecipeSchema(item) {
  const t = item['@type'];
  if (!t) return false;
  return t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'));
}

function parseJsonLd(html) {
  const re = /<script[^>]+type=["']application\/ld["'][^>]*>([\u0000-\uFFFF]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    try {
      const raw = match[1].replace(/<[^>]+>/g, '');
      const data = JSON.parse(raw);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item['@graph']) {
          const recipe = item['@graph'].find(g => isRecipeSchema(g));
          if (recipe) return parseSchemaRecipe(recipe);
        }
        if (isRecipeSchema(item)) return parseSchemaRecipe(item);
      }
    } catch {}
  }
  return null;
}

function parseSchemaRecipe(schema) {
  const text = v => {
    if (Array.isArray(v)) return v.map(String).join(' ').trim();
    return String(v || '').trim();
  };

  let instructions = [];
  const rawIn = schema.recipeInstructions || [];
  for (const item of (Array.isArray(rawIn) ? rawIn : [rawIn])) {
    if (typeof item === 'string') { instructions.push(item.trim()); }
    else if (item && item.text) { instructions.push(item.text.trim()); }
    else if (item && item['@type'] === 'HowToStep' && item.text) { instructions.push(item.text.trim()); }
    else if (item && item['@type'] === 'HowToSection' && item.itemListElement) {
      for (const s of item.itemListElement) instructions.push(typeof s === 'string' ? s.trim() : (s.text || '').trim());
    }
  }

  let image = schema.image;
  if (Array.isArray(image)) image = image[0];
  if (image && typeof image === 'object') image = image.url || image;

  let servings = schema.recipeYield;
  if (Array.isArray(servings)) servings = servings.join(', ');
  else if (typeof servings === 'object') servings = String(servings);

  const keywords = text(schema.keywords).toLowerCase();
  const category = text(schema.recipeCategory).toLowerCase();
  let proteinType = '';
  if (/beef|steak|ribeye|tenderloin/i.test(keywords + category)) proteinType = 'beef';
  else if (/chicken|poultry/i.test(keywords + category)) proteinType = 'chicken';
  else if (/pork|ham|bacon/i.test(keywords + category)) proteinType = 'pork';
  else if (/salmon|fish|seafood|tuna|shrimp|lobster/i.test(keywords + category)) proteinType = 'fish';
  else if (/vegetarian|vegan|tofu/i.test(keywords + category)) proteinType = 'vegetarian';

  let dietaryFlags = [];
  const kw = keywords + ' ' + category;
  if (/gluten|gf\b/g.test(kw)) dietaryFlags.push('gluten-free');
  if (/dairy|lactose|vegan/g.test(kw)) dietaryFlags.push('dairy-free');
  if (/vegan/i.test(kw)) dietaryFlags.push('vegan');
  else if (/vegetarian/i.test(kw)) dietaryFlags.push('vegetarian');

  return {
    name: text(schema.name),
    description: text(schema.description),
    prep_time_minutes: parseIsoDuration(schema.prepTime),
    cook_time_minutes: parseIsoDuration(schema.cookTime),
    total_time_minutes: parseIsoDuration(schema.totalTime),
    protein_type: proteinType,
    dietary_flags: dietaryFlags,
    servings: text(servings),
    image_url: text(image),
    ingredients: (schema.recipeIngredient || []).map(text),
    instructions,
    source_standard: false,
    tags: [],
  };
}

function parseIsoDuration(dur) {
  if (!dur) return 0;
  const m = String(dur).match(/PT(?:(\\d+)H)?(?:(\\d+)M)?/);
  if (!m) return 0;
  return (parseInt(m[1] || 0) * 60) + parseInt(m[2] || 0);
}

function parseOg(html) {
  const meta = (prop) => {
    const re = new RegExp(`<meta[^>]+(?:property|property)=["']og:${prop}["'][^>]+content=["']([^"']+)["']`, 'i');
    const m = html.match(re);
    if (m) return m[1];
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|property)=["']og:${prop}["']`, 'i');
    const m2 = html.match(re2);
    return m2 ? m2[1] : null;
  };
  return { og_title: meta('title'), og_desc: meta('description'), og_image: meta('image') };
}

// Select elements by itemprop attribute
function selectEls(doc, attr, value) {
  return du.filter(el => du.getAttributeValue(el, attr) === value, doc, true);
}

// Select elements by CSS class (rough)
function selectByClass(doc, cls) {
  return du.filter(el => {
    const c = du.getAttributeValue(el, 'class') || '';
    return c.includes(cls);
  }, doc, true);
}

// Select elements by tag name
function selectByTag(doc, tag) {
  return du.filter(el => el.name === tag, doc, true);
}

// Get text from element
function elText(el) {
  if (!el) return '';
  if (el.data) return String(el.data).trim();
  return (el.children || []).map(elText).join(' ').trim();
}

function parseHtmlFallback(html, site) {
  const doc = parseDocument(html, { xmlMode: false });
  const sel = { ...GENERIC_SELECTORS, ...(site || {}) };

  // Try itemprop first (works on all schema sites)
  const ingEls = selectEls(doc, 'itemprop', 'recipeIngredient');
  const insEls = selectEls(doc, 'itemprop', 'recipeInstructions');
  const imgEl = du.findOne(el => du.getAttributeValue(el, 'itemprop') === 'image', doc, true);
  const titleEl = du.findOne(el => du.getAttributeValue(el, 'itemprop') === 'name' && el.name === 'h1', doc, true);

  // Fallback: try class-based selectors
  const titleClass = sel.title.includes('class') ? sel.title.split(/[, ]/).find(s => s.startsWith('.'))?.slice(1) : null;

  const name = titleEl ? elText(titleEl) : '';
  const ingredients = ingEls.map(elText).filter(Boolean);
  const instructions = insEls.map(el => elText(el).replace(/\n/g, ' ').trim()).filter(Boolean);
  let imageUrl = '';
  if (imgEl) {
    imageUrl = du.getAttributeValue(imgEl, 'src') || du.getAttributeValue(imgEl, 'content') || '';
  }

  return { name, ingredients, instructions, image_url: imageUrl };
}

async function importRecipeFromUrl(url) {
  if (!url || !url.startsWith('http')) throw new Error('Invalid URL — must start with http');

  let html;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`Site returned HTTP ${res.status}`);
    html = await res.text();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Request timed out — the site may be blocking automated access. Try entering the recipe manually.');
    throw new Error(`Could not reach the site: ${err.message}`);
  }

  if (!html || html.length < 500) throw new Error('Site returned an empty or invalid page');

  const host = getHost(url);
  const siteSel = SITE_SELECTORS[host] || null;
  const og = parseOg(html);

  // 1. Schema.org JSON-LD
  const schema = parseJsonLd(html);
  if (schema && schema.name && schema.ingredients?.length > 0) {
    return { ...schema, source_url: url, parse_quality: 'schema' };
  }

  // 2. HTML fallback
  const htmlData = parseHtmlFallback(html, siteSel);

  // Merge OG for missing fields
  if (!htmlData.name && og.og_title) htmlData.name = og.og_title.replace(/\n/g, ' ').trim();
  if (!htmlData.image_url && og.og_image) htmlData.image_url = og.og_image;
  if (!htmlData.description && og.og_desc) htmlData.description = og.og_desc;

  if (!htmlData.name && htmlData.ingredients.length === 0) {
    throw new Error('Could not find recipe data on this page. The site may block scraping — try entering the recipe manually.');
  }

  return {
    name: htmlData.name || og.og_title || 'Imported Recipe',
    description: htmlData.description || og.og_desc || '',
    prep_time_minutes: 0,
    cook_time_minutes: 0,
    protein_type: '',
    dietary_flags: [],
    servings: '',
    image_url: htmlData.image_url || og.og_image || '',
    ingredients: htmlData.ingredients,
    instructions: htmlData.instructions,
    source_standard: false,
    tags: [],
    source_url: url,
    parse_quality: htmlData.name && htmlData.ingredients.length > 0 ? 'full' : 'partial',
  };
}

module.exports = { importRecipeFromUrl };