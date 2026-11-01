import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { importRecipesFromBoard } from '@/lib/pinterest';
import { queryOne, insert, table } from '@/lib/db';

// POST /api/recipes/import-pinterest — Import recipes from a Pinterest board
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth();
    const { boardId, saveCompliant } = await request.json();

    if (!boardId) {
      return NextResponse.json({ error: 'Board ID is required' }, { status: 400 });
    }

    // Get user's Pinterest token
    const tokenRow = await queryOne<any>(
      `SELECT access_token FROM ${table('pinterest_tokens')} WHERE user_id = ?`,
      [user.id]
    );

    if (!tokenRow) {
      return NextResponse.json(
        { error: 'Pinterest account not connected. Please connect Pinterest first.' },
        { status: 403 }
      );
    }

    // Import recipes from board
    const results = await importRecipesFromBoard(boardId, tokenRow.access_token);

    // Optionally save all compliant recipes
    let savedCount = 0;
    if (saveCompliant) {
      for (const { recipe } of results) {
        if (recipe && recipe.compliant) {
          await insert('recipes', {
            user_id: user.id,
            name: recipe.name,
            source: 'pinterest',
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
          savedCount++;
        }
      }
    }

    return NextResponse.json({
      total: results.length,
      recipesFound: results.filter(r => r.recipe).length,
      compliant: results.filter(r => r.recipe?.compliant).length,
      warnings: results.filter(r => r.recipe && !r.recipe.compliant).length,
      saved: savedCount,
      results: results.map(({ pin, recipe }) => ({
        pin: { id: pin.id, title: pin.title, link: pin.link, imageUrl: pin.imageUrl },
        recipe: recipe ? {
          name: recipe.name,
          protein: recipe.protein,
          totalTimeMinutes: recipe.totalTimeMinutes,
          servings: recipe.servings,
          ingredientCount: recipe.ingredients.length,
          compliant: recipe.compliant,
          warnings: recipe.warnings,
        } : null,
      })),
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('Pinterest import error:', error);
    return NextResponse.json({ error: 'Failed to import from Pinterest' }, { status: 500 });
  }
}
