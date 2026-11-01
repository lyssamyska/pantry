// ═══════════════════════════════════════════════════════
// Dietary Compliance Engine
// Scans recipe ingredients for banned items and
// verifies protein sourcing requirements
// ═══════════════════════════════════════════════════════

export interface ComplianceResult {
  compliant: boolean;
  warnings: string[];
}

// ── Banned ingredients (gluten + sugar) ───────────────
const BANNED = [
  // Gluten sources
  'gluten', 'wheat', 'wheat flour', 'all-purpose flour', 'bread flour',
  'cake flour', 'pastry flour', 'semolina', 'farina', 'barley', 'rye',
  'spelt', 'triticale', 'bulgur', 'couscous', 'farro', 'kamut',
  'bread crumbs', 'panko', 'croutons', 'flour tortilla',
  'soy sauce', 'teriyaki sauce', 'hoisin sauce', 'malt',
  'beer', 'seitan',
  // Sugar sources
  'sugar', 'brown sugar', 'powdered sugar', 'confectioners sugar',
  'cane sugar', 'granulated sugar', 'corn syrup', 'high-fructose corn syrup',
  'maltodextrin', 'dextrose', 'sucrose', 'agave', 'agave nectar',
  'maple syrup', 'honey', 'molasses', 'turbinado',
];

// These are OK — don't flag them
const ALLOWED_SWEETENERS = [
  'stevia', 'monk fruit', 'erythritol', 'allulose', 'xylitol',
];

// ── Protein sourcing requirements ─────────────────────
const PROTEIN_RULES: Record<string, string> = {
  beef: 'grass-fed',
  steak: 'grass-fed',
  'ground beef': 'grass-fed',
  'beef chuck': 'grass-fed',
  'beef brisket': 'grass-fed',
  'flank steak': 'grass-fed',
  'ribeye': 'grass-fed',
  'sirloin': 'grass-fed',
  chicken: 'free-range',
  'chicken breast': 'free-range',
  'chicken thigh': 'free-range',
  'chicken thighs': 'free-range',
  'chicken wing': 'free-range',
  turkey: 'free-range',
  'ground turkey': 'free-range',
  salmon: 'wild-caught',
  fish: 'wild-caught',
  shrimp: 'wild-caught',
  tuna: 'wild-caught',
  cod: 'wild-caught',
  halibut: 'wild-caught',
  trout: 'wild-caught',
  mahi: 'wild-caught',
  swordfish: 'wild-caught',
  sea bass: 'wild-caught',
  snapper: 'wild-caught',
};

// ── Main compliance check ─────────────────────────────
export function checkCompliance(ingredients: string[]): ComplianceResult {
  const warnings: string[] = [];
  const joined = ingredients.map(i => i.toLowerCase()).join(' ||| ');

  // Check banned ingredients
  for (const banned of BANNED) {
    // Skip if an allowed sweetener contains this substring
    if (ALLOWED_SWEETENERS.some(a => a.includes(banned))) continue;

    for (const ingredient of ingredients) {
      const lower = ingredient.toLowerCase();
      if (lower.includes(banned)) {
        // Double-check it's not part of an allowed sweetener
        if (!ALLOWED_SWEETENERS.some(a => lower.includes(a))) {
          warnings.push(`Contains "${banned}" in: "${ingredient}"`);
        }
      }
    }
  }

  // Check protein sourcing
  for (const [protein, requiredQualifier] of Object.entries(PROTEIN_RULES)) {
    for (const ingredient of ingredients) {
      const lower = ingredient.toLowerCase();
      if (lower.includes(protein)) {
        const hasQualifier =
          lower.includes(requiredQualifier) ||
          lower.includes(requiredQualifier.replace('-', ' '));

        if (!hasQualifier) {
          warnings.push(
            `"${ingredient}" — ${protein} should be labeled ${requiredQualifier}. Verify sourcing.`
          );
        }
      }
    }
  }

  // Deduplicate warnings
  const unique = [...new Set(warnings)];

  return {
    compliant: unique.length === 0,
    warnings: unique,
  };
}

// ── Detect primary protein ────────────────────────────
export function detectProtein(ingredients: string[]): string | null {
  const text = ingredients.join(' ').toLowerCase();
  if (/salmon|fish|shrimp|cod|tuna|halibut|trout|mahi|sea bass|snapper/.test(text)) return 'fish';
  if (/chicken|turkey/.test(text)) return 'chicken';
  if (/beef|steak|sirloin|ribeye|brisket/.test(text)) return 'beef';
  return null;
}
