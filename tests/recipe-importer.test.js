const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractRecipeFromHtml,
  findRecipeInJsonLd,
  parseIsoDuration,
  getHost,
  importRecipeFromUrl,
} = require('../services/recipe-importer');

const ldPage = (json) => `<!doctype html><html><head><title>t</title>
<script type="application/ld+json">${JSON.stringify(json)}</script></head><body><h1>Wrong title</h1></body></html>`;

const TACOS = {
  '@type': 'Recipe',
  name: 'Fish Tacos &amp; Slaw',
  prepTime: 'PT15M',
  cookTime: 'PT1H5M',
  totalTime: 'PT1H20M',
  recipeYield: ['4', '4 tacos'],
  image: [{ '@type': 'ImageObject', url: 'https://example.com/tacos.jpg' }],
  recipeIngredient: ['1 lb wild-caught cod', '8 corn tortillas', '2 tbsp coconut aminos', 'sugar-free ketchup'],
  recipeInstructions: [
    { '@type': 'HowToSection', name: 'Fish', itemListElement: [{ '@type': 'HowToStep', text: 'Season the <b>fish</b>.' }] },
    { '@type': 'HowToStep', text: 'Warm tortillas.' },
    'Assemble.',
  ],
  keywords: 'tacos, dairy free',
};

test('getHost strips a leading "www." (not "www/")', () => {
  assert.equal(getHost('https://www.seriouseats.com/x'), 'seriouseats.com');
  assert.equal(getHost('https://cooking.nytimes.com/x'), 'cooking.nytimes.com');
  assert.equal(getHost('https://wwwfood.com/x'), 'wwwfood.com');
  assert.equal(getHost('not a url'), '');
});

test('parseIsoDuration handles hours, minutes, seconds, days, and junk', () => {
  assert.equal(parseIsoDuration('PT15M'), 15);
  assert.equal(parseIsoDuration('PT1H30M'), 90);
  assert.equal(parseIsoDuration('PT2H'), 120);
  assert.equal(parseIsoDuration('P0DT0H45M'), 45);
  assert.equal(parseIsoDuration('PT90S'), 2);
  assert.equal(parseIsoDuration('P1D'), 1440);
  assert.equal(parseIsoDuration('20 minutes'), 0);
  assert.equal(parseIsoDuration(undefined), 0);
});

test('reads application/ld+json (the old regex only matched "application/ld")', () => {
  const recipe = extractRecipeFromHtml(ldPage(TACOS), 'https://www.example.com/tacos');
  assert.equal(recipe.parse_quality, 'schema');
  assert.equal(recipe.name, 'Fish Tacos & Slaw');
  assert.equal(recipe.prep_time_minutes, 15);
  assert.equal(recipe.cook_time_minutes, 65);
  assert.equal(recipe.total_time_minutes, 80);
  assert.equal(recipe.servings, '4');
  assert.equal(recipe.image_url, 'https://example.com/tacos.jpg');
  assert.equal(recipe.ingredients.length, 4);
  assert.deepEqual(recipe.instructions, ['Season the fish.', 'Warm tortillas.', 'Assemble.']);
  assert.equal(recipe.protein_type, 'fish');
  assert.equal(recipe.source_url, 'https://www.example.com/tacos');
});

test('finds a Recipe inside @graph, arrays, array @type, and mainEntity', () => {
  const graph = { '@context': 'https://schema.org', '@graph': [{ '@type': 'WebPage' }, { '@type': 'Person', name: 'x' }, TACOS] };
  assert.equal(extractRecipeFromHtml(ldPage(graph)).name, 'Fish Tacos & Slaw');

  const array = [{ '@type': 'Organization' }, { ...TACOS, '@type': ['Recipe', 'NewsArticle'] }];
  assert.equal(extractRecipeFromHtml(ldPage(array)).name, 'Fish Tacos & Slaw');

  assert.equal(findRecipeInJsonLd({ '@type': 'WebPage', mainEntity: TACOS }).name, TACOS.name);
  assert.equal(findRecipeInJsonLd({ '@graph': [{ '@graph': [TACOS] }] }).name, TACOS.name);
  assert.equal(findRecipeInJsonLd({ '@type': 'http://schema.org/Recipe', name: 'iri' }).name, 'iri');
  assert.equal(findRecipeInJsonLd({ '@type': 'WebPage' }), null);
});

test('skips broken JSON-LD blocks and uses the next one', () => {
  const html = `<html><head>
    <script type="application/ld+json">{ not json</script>
    <script type="application/ld+json">${JSON.stringify({ '@type': 'Organization' })}</script>
    <script type="application/ld+json">${JSON.stringify(TACOS)}</script>
  </head><body></body></html>`;
  assert.equal(extractRecipeFromHtml(html).name, 'Fish Tacos & Slaw');
});

test('falls back to schema.org microdata, ignoring nested author name', () => {
  const html = `<html><body>
    <div itemscope itemtype="https://schema.org/Recipe">
      <span itemprop="author" itemscope itemtype="https://schema.org/Person"><span itemprop="name">Jane Cook</span></span>
      <h1 itemprop="name">Pastured Chicken Soup</h1>
      <meta itemprop="prepTime" content="PT10M"><meta itemprop="cookTime" content="PT40M">
      <span itemprop="recipeYield">6 servings</span>
      <img itemprop="image" src="https://example.com/soup.jpg">
      <ul>
        <li itemprop="recipeIngredient">2 lbs pastured chicken thighs</li>
        <li itemprop="recipeIngredient">8 cups chicken stock</li>
        <li itemprop="recipeIngredient">8 oz egg noodles</li>
      </ul>
      <div itemprop="recipeInstructions"><ol><li>Simmer chicken.</li><li>Add noodles.</li></ol></div>
    </div></body></html>`;
  const recipe = extractRecipeFromHtml(html, 'https://example.com/soup');
  assert.equal(recipe.parse_quality, 'microdata');
  assert.equal(recipe.name, 'Pastured Chicken Soup');
  assert.equal(recipe.prep_time_minutes, 10);
  assert.equal(recipe.cook_time_minutes, 40);
  assert.equal(recipe.servings, '6 servings');
  assert.equal(recipe.image_url, 'https://example.com/soup.jpg');
  assert.deepEqual(recipe.instructions, ['Simmer chicken.', 'Add noodles.']);
  assert.equal(recipe.protein_type, 'chicken');
  // compliance ran: egg noodles → not gluten-free
  assert.equal(recipe.compliance.glutenFree, false);
  assert.ok(!recipe.dietary_flags.includes('gluten-free'));
  assert.ok(recipe.dietary_flags.includes('sugar-free'));
});

test('falls back to Open Graph when there is no structured data', () => {
  const html = `<html><head><meta property="og:title" content="Weeknight Stew"><meta property="og:image" content="https://e.com/s.jpg"></head><body></body></html>`;
  const recipe = extractRecipeFromHtml(html);
  assert.equal(recipe.name, 'Weeknight Stew');
  assert.equal(recipe.parse_quality, 'partial');
  assert.equal(extractRecipeFromHtml('<html><body><p>nothing</p></body></html>'), null);
});

test('imported recipes run through the compliance check', () => {
  const compliant = extractRecipeFromHtml(ldPage(TACOS));
  assert.equal(compliant.compliance.compliant, true, compliant.compliance.warnings.join('; '));
  assert.deepEqual(compliant.dietary_flags.sort(), ['dairy-free', 'gluten-free', 'sugar-free']);

  const flagged = extractRecipeFromHtml(ldPage({
    ...TACOS,
    keywords: 'gluten free, sugar free', // page claims — must not be trusted
    recipeIngredient: ['1 lb salmon', '2 tbsp soy sauce', '1 tbsp honey'],
  }));
  assert.equal(flagged.compliance.compliant, false);
  assert.equal(flagged.compliance.glutenFree, false);
  assert.equal(flagged.compliance.sugarFree, false);
  assert.equal(flagged.compliance.sourcingOk, false);
  assert.equal(flagged.compliance.warnings.length, 3);
  assert.deepEqual(flagged.dietary_flags, []);
});

test('importRecipeFromUrl fetches, extracts, and reports the host', async () => {
  const html = ldPage(TACOS) + ' '.repeat(500);
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => html });
  const recipe = await importRecipeFromUrl('https://www.example.com/tacos', { fetchImpl });
  assert.equal(recipe.source_host, 'example.com');
  assert.equal(recipe.name, 'Fish Tacos & Slaw');

  await assert.rejects(importRecipeFromUrl('ftp://x'), /Invalid URL/);
  await assert.rejects(
    importRecipeFromUrl('https://e.com', { fetchImpl: async () => ({ ok: false, status: 403 }) }),
    /HTTP 403/
  );
});

test('saving an import recomputes gluten-free / sugar-free server-side', async () => {
  const { pool } = require('../db/index');
  const { saveImportedRecipe } = require('../db/recipe-import');
  const original = pool.query;
  let params;
  pool.query = async (_sql, values) => { params = values; return { rows: [{ id: 1 }] }; };
  try {
    await saveImportedRecipe({
      name: 'Sneaky Noodles',
      dietary_flags: ['gluten-free', 'sugar-free', 'dairy-free'],
      ingredients: ['8 oz egg noodles', '1 tbsp honey'],
    });
    assert.deepEqual(params[5], ['dairy-free']);

    await saveImportedRecipe({ name: 'Clean', dietary_flags: [], ingredients: ['2 cups cauliflower rice', 'coconut aminos'] });
    assert.deepEqual(params[5].sort(), ['gluten-free', 'sugar-free']);
  } finally {
    pool.query = original;
  }
});
