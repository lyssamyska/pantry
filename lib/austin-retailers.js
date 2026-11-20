const PRIMARY_AUSTIN_RETAILER_SLUG = 'heb';
const SUPPORTED_AUSTIN_RETAILER_SLUGS = new Set([
  PRIMARY_AUSTIN_RETAILER_SLUG,
  'whole-foods',
  'sprouts',
  'central-market',
  'barton-springs'
]);

const AUSTIN_RETAILER_DISPLAY_NAMES = new Set([
  'H-E-B',
  'Whole Foods',
  'Sprouts',
  'Central Market',
  'Barton Springs Market'
]);

// Shown wherever prices appear. Every price in Pantry is seeded, not live.
const PRICE_ESTIMATE_NOTICE = 'Prices are estimates from Pantry\u2019s seeded Austin price list, not live store prices. Check in store before you shop.';

function isSupportedAustinStoreSlug(slug) {
  return SUPPORTED_AUSTIN_RETAILER_SLUGS.has(String(slug || '').trim().toLowerCase());
}

function isSupportedAustinStoreName(name) {
  return AUSTIN_RETAILER_DISPLAY_NAMES.has(String(name || '').trim());
}

function selectAustinPrice(rows) {
  const eligible = (rows || [])
    .filter(row => row && isSupportedAustinStoreSlug(row.store_slug))
    .filter(row => Number.isFinite(Number(row.price)))
    .sort((a, b) => {
      const aPrimary = String(a.store_slug).trim().toLowerCase() === PRIMARY_AUSTIN_RETAILER_SLUG ? 0 : 1;
      const bPrimary = String(b.store_slug).trim().toLowerCase() === PRIMARY_AUSTIN_RETAILER_SLUG ? 0 : 1;
      if (aPrimary !== bPrimary) return aPrimary - bPrimary;

      const priceDifference = Number(a.price) - Number(b.price);
      if (priceDifference !== 0) return priceDifference;

      const slugDifference = String(a.store_slug).localeCompare(String(b.store_slug));
      if (slugDifference !== 0) return slugDifference;
      return String(a.store_name || '').localeCompare(String(b.store_name || ''));
    });

  return eligible[0] || null;
}

module.exports = {
  PRIMARY_AUSTIN_RETAILER_SLUG,
  SUPPORTED_AUSTIN_RETAILER_SLUGS,
  AUSTIN_RETAILER_DISPLAY_NAMES,
  PRICE_ESTIMATE_NOTICE,
  isSupportedAustinStoreSlug,
  isSupportedAustinStoreName,
  selectAustinPrice
};
