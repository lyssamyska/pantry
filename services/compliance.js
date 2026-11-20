// Dietary compliance engine. Ported from
// reference/meal-agent-starter/lib/compliance.ts, with fixes:
//   - the 'sea bass' rule key is quoted (it was a syntax error in the starter);
//   - "<x>-free" / "<x> free" / "no <x>" / "no added <x>" never count as containing <x>
//     ("sugar-free ketchup", "gluten-free flour", "no sugar added");
//   - coconut aminos, Siete products and cauliflower rice are always compliant;
//   - matching is whole-word, so "buckwheat", "honeydew" and "dryer" don't hit;
//   - Pantry sourcing standard: chicken/turkey must be pastured (not "free-range").
//
// Rules are grouped by the dietary flag they back:
//   gluten rules  → 'gluten-free'
//   sugar rules   → 'sugar-free'
//   sourcing rules apply to every recipe (Pantry's quality standard).

const GLUTEN_TERMS = [
  'gluten', 'wheat', 'wheat flour', 'all-purpose flour', 'bread flour', 'cake flour', 'pastry flour', 'flour',
  'semolina', 'farina', 'barley', 'rye', 'spelt', 'triticale', 'bulgur', 'couscous', 'farro', 'kamut',
  'bread', 'breadcrumbs', 'bread crumbs', 'panko', 'croutons', 'crackers', 'flour tortilla', 'tortilla',
  'pasta', 'spaghetti', 'penne', 'linguine', 'fettuccine', 'rigatoni', 'macaroni', 'lasagna', 'orzo',
  'noodles', 'egg noodles', 'ramen', 'udon', 'soba', 'naan', 'pita', 'bun', 'brioche', 'baguette',
  'soy sauce', 'teriyaki', 'teriyaki sauce', 'hoisin', 'hoisin sauce', 'oyster sauce', 'gochujang',
  'malt', 'malt vinegar', 'beer', 'seitan',
];

const SUGAR_TERMS = [
  'sugar', 'brown sugar', 'powdered sugar', 'confectioners sugar', 'cane sugar', 'granulated sugar',
  'coconut sugar', 'corn syrup', 'high-fructose corn syrup', 'maltodextrin', 'dextrose', 'sucrose',
  'agave', 'agave nectar', 'maple syrup', 'honey', 'molasses', 'turbinado',
  'ketchup', 'bbq sauce', 'barbecue sauce', 'teriyaki', 'teriyaki sauce', 'hoisin', 'hoisin sauce',
  'mirin', 'sweet chili sauce', 'gochujang',
];

// Sweeteners that are fine on a sugar-free plan.
const ALLOWED_SWEETENERS = ['stevia', 'monk fruit', 'erythritol', 'allulose', 'xylitol'];

// Always compliant (both gluten and sugar), whatever else the line says.
const ALWAYS_COMPLIANT = [/\bcoconut aminos\b/, /\bsiete\b/, /\bcauliflower rice\b/, /\briced cauliflower\b/];

// Phrases that contain a banned word but aren't the banned thing. Removed
// before matching.
const GLUTEN_SAFE_PHRASES = [
  /\b(?:rice|zucchini|zoodle|glass|kelp|shirataki|sweet potato|bean thread|cellophane|mung bean|konjac)\s+(?:noodles?|pasta|spaghetti)\b/g,
  /\b(?:chickpea|lentil|brown rice|rice|corn|cassava|quinoa)\s+(?:pasta|spaghetti|penne|fusilli|tortillas?)\b/g,
  /\bspaghetti squash\b/g,
  /\bcorn\s+tortillas?\b/g,
  /\b(?:almond|coconut|cassava|tapioca|rice|brown rice|chickpea|garbanzo|oat|arrowroot|potato|corn|sorghum|buckwheat)\s+(?:flour|starch)\b/g,
  /\brice paper\b/g,
  /\btamari\b/g,
  /\bbreadfruit\b/g,
];
const SUGAR_SAFE_PHRASES = [/\bsugar snap(?: peas?)?\b/g, /\bsnap peas\b/g];

// "gluten-free", "no sugar added", "unsweetened"… clear a whole category for that line.
const GLUTEN_NEGATIONS = /\b(?:gluten|wheat|grain)[-\s]?free\b|\bno[-\s]+(?:gluten|wheat)\b|\bwithout\s+gluten\b/;
const SUGAR_NEGATIONS = /\b(?:sugar|sugars)[-\s]?free\b|\bno[-\s]+(?:added[-\s]+)?sugars?\b|\bno[-\s]+sugars?[-\s]+added\b|\bwithout\s+(?:added\s+)?sugars?\b|\bunsweetened\b|\bzero[-\s]sugar\b/;

// ── Protein sourcing ──────────────────────────────────
const QUALIFIERS = {
  'grass-fed': /\bgrass[-\s]?(?:fed|finished)\b/,
  pastured: /\bpastured\b|\bpasture[-\s]?raised\b/,
  'wild-caught': /\bwild(?:[-\s]?caught)?\b/,
};

const PROTEIN_RULES = {
  beef: 'grass-fed',
  steak: 'grass-fed',
  'ground beef': 'grass-fed',
  'beef chuck': 'grass-fed',
  'beef brisket': 'grass-fed',
  brisket: 'grass-fed',
  'flank steak': 'grass-fed',
  ribeye: 'grass-fed',
  sirloin: 'grass-fed',
  'tri-tip': 'grass-fed',
  chicken: 'pastured',
  'chicken breast': 'pastured',
  'chicken thigh': 'pastured',
  'chicken thighs': 'pastured',
  'chicken wing': 'pastured',
  turkey: 'pastured',
  'ground turkey': 'pastured',
  salmon: 'wild-caught',
  fish: 'wild-caught',
  shrimp: 'wild-caught',
  tuna: 'wild-caught',
  cod: 'wild-caught',
  halibut: 'wild-caught',
  trout: 'wild-caught',
  mahi: 'wild-caught',
  'mahi-mahi': 'wild-caught',
  swordfish: 'wild-caught',
  'sea bass': 'wild-caught',
  snapper: 'wild-caught',
  tilapia: 'wild-caught',
  mackerel: 'wild-caught',
  scallops: 'wild-caught',
  crab: 'wild-caught',
};

// "Steak" is only beef when nothing else on the line says what it is
// ("swordfish steak", "cauliflower steak", "tuna steak").
const NON_BEEF_STEAK = /\b(?:swordfish|tuna|salmon|halibut|mahi|fish|cauliflower|cabbage|eggplant|portobello|mushroom|celery root|tofu|pork|lamb|ham)\s+steaks?\b/;

// Pantry staples that mention a protein but aren't the protein itself.
const SOURCING_EXEMPT = /\b(?:broth|stock|bouillon|base|fish sauce|bone broth|consomm[eé])\b/;

// ── Helpers ───────────────────────────────────────────
function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function termRegex(term) {
  // Whole word, optional plural; hyphens and spaces interchangeable.
  const body = escapeRegex(term).replace(/-|\s+/g, '[-\\s]');
  return new RegExp(`(?<![a-z])${body}(?:e?s)?(?![a-z])`, 'g');
}

const byLengthDesc = (a, b) => b.length - a.length;
const GLUTEN_MATCHERS = [...new Set(GLUTEN_TERMS)].sort(byLengthDesc).map((t) => [t, termRegex(t)]);
const SUGAR_MATCHERS = [...new Set(SUGAR_TERMS)].sort(byLengthDesc).map((t) => [t, termRegex(t)]);
const PROTEIN_MATCHERS = Object.keys(PROTEIN_RULES).sort(byLengthDesc).map((t) => [t, termRegex(t)]);

function ingredientText(ingredient) {
  if (ingredient == null) return '';
  if (typeof ingredient === 'string') return ingredient;
  if (typeof ingredient === 'object') {
    return [ingredient.quantity, ingredient.name, ingredient.sourcing_hint, ingredient.notes]
      .filter((part) => part != null && String(part).trim() !== '')
      .join(' ');
  }
  return String(ingredient);
}

// An occurrence is negated when written as "<x>-free", "<x> free", "no <x>" or "no added <x>".
function isNegated(text, start, end) {
  const before = text.slice(Math.max(0, start - 16), start);
  const after = text.slice(end, end + 8);
  return /\bno[-\s]+(?:added[-\s]+)?$/.test(before) || /^[-\s]?free\b/.test(after);
}

// Finds banned terms, longest first, blanking each match so "brown sugar"
// isn't also reported as "sugar".
function findTerms(text, matchers) {
  let working = text;
  const found = [];
  for (const [term, pattern] of matchers) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(working)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (!isNegated(working, start, end)) found.push(term);
      working = working.slice(0, start) + ' '.repeat(end - start) + working.slice(end);
    }
  }
  return [...new Set(found)];
}

function stripPhrases(text, phrases) {
  return phrases.reduce((current, pattern) => current.replace(pattern, (m) => ' '.repeat(m.length)), text);
}

function quoteList(terms) {
  return terms.map((t) => `"${t}"`).join(', ');
}

function isAlwaysCompliant(lower) {
  return ALWAYS_COMPLIANT.some((pattern) => pattern.test(lower));
}

function checkGluten(lower) {
  if (isAlwaysCompliant(lower) || GLUTEN_NEGATIONS.test(lower)) return [];
  return findTerms(stripPhrases(lower, GLUTEN_SAFE_PHRASES), GLUTEN_MATCHERS);
}

function checkSugar(lower) {
  if (isAlwaysCompliant(lower) || SUGAR_NEGATIONS.test(lower)) return [];
  if (ALLOWED_SWEETENERS.some((sweetener) => lower.includes(sweetener))) return [];
  return findTerms(stripPhrases(lower, SUGAR_SAFE_PHRASES), SUGAR_MATCHERS);
}

function checkSourcing(lower) {
  if (SOURCING_EXEMPT.test(lower)) return [];
  let proteins = findTerms(lower, PROTEIN_MATCHERS);
  if (NON_BEEF_STEAK.test(lower)) proteins = proteins.filter((p) => p !== 'steak');
  const issues = [];
  for (const protein of proteins) {
    const qualifier = PROTEIN_RULES[protein];
    if (!QUALIFIERS[qualifier].test(lower)) issues.push({ protein, qualifier });
  }
  return issues;
}

// ── Main compliance check ─────────────────────────────
// ingredients: strings, or Pantry ingredient objects { name, quantity, sourcing_hint }.
function checkCompliance(ingredients) {
  const issues = [];
  for (const ingredient of Array.isArray(ingredients) ? ingredients : []) {
    const original = ingredientText(ingredient).trim();
    if (!original) continue;
    const lower = original.toLowerCase();

    const glutenTerms = checkGluten(lower);
    if (glutenTerms.length) {
      issues.push({ type: 'gluten', terms: glutenTerms, ingredient: original, message: `Contains ${quoteList(glutenTerms)} (gluten) in: "${original}"` });
    }
    const sugarTerms = checkSugar(lower);
    if (sugarTerms.length) {
      issues.push({ type: 'sugar', terms: sugarTerms, ingredient: original, message: `Contains ${quoteList(sugarTerms)} (sugar) in: "${original}"` });
    }
    for (const { protein, qualifier } of checkSourcing(lower)) {
      issues.push({
        type: 'sourcing',
        terms: [protein],
        ingredient: original,
        message: `"${original}" — ${protein} should be labeled ${qualifier}. Verify sourcing.`,
      });
    }
  }

  const unique = [];
  const seen = new Set();
  for (const issue of issues) {
    if (seen.has(issue.message)) continue;
    seen.add(issue.message);
    unique.push(issue);
  }

  const glutenFree = !unique.some((i) => i.type === 'gluten');
  const sugarFree = !unique.some((i) => i.type === 'sugar');
  const sourcingOk = !unique.some((i) => i.type === 'sourcing');
  return {
    compliant: unique.length === 0,
    glutenFree,
    sugarFree,
    sourcingOk,
    issues: unique,
    warnings: unique.map((i) => i.message),
  };
}

// Flags this checker can verify, and which result field backs each one.
const VERIFIABLE_FLAGS = { 'gluten-free': 'glutenFree', 'sugar-free': 'sugarFree' };

// The gluten-free / sugar-free flags an ingredient list actually earns.
function deriveDietaryFlags(ingredients) {
  const result = checkCompliance(ingredients);
  return Object.entries(VERIFIABLE_FLAGS).filter(([, key]) => result[key]).map(([flag]) => flag);
}

// Checks a recipe's claimed flags against its ingredients.
// falseFlags: claimed but not met. missingFlags: met but not claimed.
function auditRecipe(recipe) {
  const result = checkCompliance(recipe && recipe.ingredients);
  const claimed = new Set((recipe && recipe.dietary_flags) || []);
  const falseFlags = [];
  const missingFlags = [];
  for (const [flag, key] of Object.entries(VERIFIABLE_FLAGS)) {
    if (claimed.has(flag) && !result[key]) falseFlags.push(flag);
    if (!claimed.has(flag) && result[key]) missingFlags.push(flag);
  }
  return { ...result, falseFlags, missingFlags };
}

// Keeps unverifiable flags (dairy-free, vegetarian…) and replaces the
// verifiable ones with what the ingredients earn.
function reconcileDietaryFlags(existingFlags, ingredients) {
  const kept = (existingFlags || []).filter((flag) => !(flag in VERIFIABLE_FLAGS));
  return [...new Set([...kept, ...deriveDietaryFlags(ingredients)])];
}

// ── Detect primary protein ────────────────────────────
function detectProtein(ingredients) {
  const text = (Array.isArray(ingredients) ? ingredients : []).map(ingredientText).join(' ').toLowerCase();
  if (/salmon|fish|shrimp|cod|tuna|halibut|trout|mahi|sea bass|snapper|tilapia|mackerel|scallop|crab/.test(text)) return 'fish';
  if (/chicken|turkey/.test(text)) return 'chicken';
  if (/beef|steak|sirloin|ribeye|brisket|tri-tip/.test(text)) return 'beef';
  if (/pork|bacon|ham\b|prosciutto|sausage/.test(text)) return 'pork';
  return null;
}

module.exports = {
  GLUTEN_TERMS,
  SUGAR_TERMS,
  ALLOWED_SWEETENERS,
  PROTEIN_RULES,
  VERIFIABLE_FLAGS,
  checkCompliance,
  deriveDietaryFlags,
  auditRecipe,
  reconcileDietaryFlags,
  detectProtein,
};
