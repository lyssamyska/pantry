import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { scrapeRecipeFromUrl } from '@/lib/scraper';
import { insert, table } from '@/lib/db';

// POST /api/recipes/import-url — Scrape a recipe URL and save it
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth();
    const { url, saveImmediately } = await request.json();

    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    const recipe = await scrapeRecipeFromUrl(url);

    if (!recipe) {
      return NextResponse.json(
        { error: 'Could not find a recipe on that page. Make sure the site uses schema.org/Recipe markup.' },
        { status: 404 }
      );
    }

    // Optionally save to database immediately
    if (saveImmediately) {
      const id = await insert('recipes', {
        user_id: user.id,
        name: recipe.name,
        source: recipe.source,
        source_url: recipe.sourceUrl,
        protein: recipe.protein,
        total_time_minutes: recipe.totalTimeMinutes,
        servings: recipe.servings,
        ingredients: JSON.stringify(recipe.ingredients),
        instructions: JSON.stringify(recipe.instructions),
        tags: JSON.stringify(recipe.tags),
        compliant: recipe.compliant,
        warnings: JSON.stringify(recipe.warnings),
        schema_org_json: recipe.schemaOrgJson ? JSON.stringify(recipe.schemaOrgJson) : null,
        image_url: recipe.imageUrl,
      });
      return NextResponse.json({ recipe: { ...recipe, id }, saved: true });
    }

    return NextResponse.json({ recipe, saved: false });
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('Import URL error:', error);
    return NextResponse.json({ error: 'Failed to import recipe' }, { status: 500 });
  }
}
