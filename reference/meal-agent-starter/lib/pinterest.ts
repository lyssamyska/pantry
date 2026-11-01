import { scrapeRecipeFromUrl, ScrapedRecipe } from './scraper';

// ═══════════════════════════════════════════════════════
// Pinterest API Client
// OAuth 2.0 flow + board/pin reading + recipe extraction
// ═══════════════════════════════════════════════════════

const PINTEREST_API = 'https://api.pinterest.com/v5';

// ── OAuth helpers ─────────────────────────────────────
export function getPinterestAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.PINTEREST_CLIENT_ID || '',
    redirect_uri: process.env.PINTEREST_REDIRECT_URI || '',
    response_type: 'code',
    scope: 'boards:read,pins:read',
    state,
  });
  return `https://www.pinterest.com/oauth/?${params}`;
}

export async function exchangePinterestCode(code: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
}> {
  const credentials = Buffer.from(
    `${process.env.PINTEREST_CLIENT_ID}:${process.env.PINTEREST_CLIENT_SECRET}`
  ).toString('base64');

  const res = await fetch(`${PINTEREST_API}/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.PINTEREST_REDIRECT_URI || '',
    }),
  });

  if (!res.ok) throw new Error(`Pinterest token exchange failed: ${res.status}`);
  return res.json();
}

export async function refreshPinterestToken(refreshToken: string) {
  const credentials = Buffer.from(
    `${process.env.PINTEREST_CLIENT_ID}:${process.env.PINTEREST_CLIENT_SECRET}`
  ).toString('base64');

  const res = await fetch(`${PINTEREST_API}/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) throw new Error('Pinterest token refresh failed');
  return res.json();
}

// ── Board & pin operations ────────────────────────────
export interface PinterestPin {
  id: string;
  title: string;
  description: string;
  link: string | null;
  imageUrl: string | null;
}

export async function getUserBoards(accessToken: string) {
  const res = await fetch(`${PINTEREST_API}/boards?page_size=50`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Failed to fetch boards: ${res.status}`);
  const data = await res.json();
  return data.items || [];
}

export async function getBoardPins(boardId: string, accessToken: string): Promise<PinterestPin[]> {
  const allPins: PinterestPin[] = [];
  let bookmark: string | null = null;

  do {
    const url = new URL(`${PINTEREST_API}/boards/${boardId}/pins`);
    url.searchParams.set('page_size', '100');
    if (bookmark) url.searchParams.set('bookmark', bookmark);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) break;
    const data = await res.json();

    for (const pin of (data.items || [])) {
      allPins.push({
        id: pin.id,
        title: pin.title || '',
        description: pin.description || '',
        link: pin.link || null,
        imageUrl: pin.media?.images?.['600x']?.url || null,
      });
    }

    bookmark = data.bookmark || null;
  } while (bookmark);

  return allPins;
}

// ── Import recipes from a board ───────────────────────
export async function importRecipesFromBoard(
  boardId: string,
  accessToken: string,
  onProgress?: (msg: string) => void
): Promise<{ pin: PinterestPin; recipe: ScrapedRecipe | null }[]> {
  onProgress?.('Reading board pins...');
  const pins = await getBoardPins(boardId, accessToken);

  onProgress?.(`Found ${pins.length} pins. Extracting recipes...`);
  const results: { pin: PinterestPin; recipe: ScrapedRecipe | null }[] = [];

  // Process pins that have outbound links (recipe URLs)
  const recipePins = pins.filter(p => p.link);

  for (let i = 0; i < recipePins.length; i++) {
    const pin = recipePins[i];
    onProgress?.(`Scraping ${i + 1}/${recipePins.length}: ${pin.title || pin.link}`);

    try {
      const recipe = await scrapeRecipeFromUrl(pin.link!);
      if (recipe) {
        recipe.source = 'pinterest';
        recipe.imageUrl = recipe.imageUrl || pin.imageUrl;
      }
      results.push({ pin, recipe });
    } catch {
      results.push({ pin, recipe: null });
    }

    // Rate limit: small delay between requests
    if (i < recipePins.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  const found = results.filter(r => r.recipe).length;
  onProgress?.(`Done! Extracted ${found} recipes from ${recipePins.length} pins.`);

  return results;
}
