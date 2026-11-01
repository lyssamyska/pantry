import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, queryOne, insert, update, remove, table } from '@/lib/db';
import { checkCompliance, detectProtein } from '@/lib/compliance';

// GET /api/recipes — List user's recipes
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth();
    const url = new URL(request.url);
    const compliantOnly = url.searchParams.get('compliant') === 'true';
    const search = url.searchParams.get('q');

    let sql = `SELECT * FROM ${table('recipes')} WHERE user_id = ?`;
    const params: any[] = [user.id];

    if (compliantOnly) {
      sql += ' AND compliant = TRUE';
    }
    if (search) {
      sql += ' AND MATCH(name) AGAINST(? IN NATURAL LANGUAGE MODE)';
      params.push(search);
    }

    sql += ' ORDER BY created_at DESC';

    const recipes = await query(sql, params);

    // Parse JSON fields
    const parsed = recipes.map((r: any) => ({
      ...r,
      ingredients: JSON.parse(r.ingredients || '[]'),
      instructions: JSON.parse(r.instructions || '[]'),
      tags: JSON.parse(r.tags || '[]'),
      warnings: JSON.parse(r.warnings || '[]'),
    }));

    return NextResponse.json({ recipes: parsed });
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to fetch recipes' }, { status: 500 });
  }
}

// POST /api/recipes — Create a recipe manually
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth();
    const body = await request.json();

    const ingredients: string[] = body.ingredients || [];
    const compliance = checkCompliance(ingredients);

    const id = await insert('recipes', {
      user_id: user.id,
      name: body.name,
      source: body.source || 'manual',
      source_url: body.sourceUrl || null,
      protein: body.protein || detectProtein(ingredients),
      total_time_minutes: body.totalTimeMinutes || 30,
      servings: body.servings || 4,
      ingredients: JSON.stringify(ingredients),
      instructions: JSON.stringify(body.instructions || []),
      tags: JSON.stringify(body.tags || []),
      compliant: compliance.compliant,
      warnings: JSON.stringify(compliance.warnings),
      image_url: body.imageUrl || null,
    });

    return NextResponse.json({ id, ...compliance }, { status: 201 });
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to create recipe' }, { status: 500 });
  }
}

// DELETE /api/recipes?id=123 — Delete a recipe
export async function DELETE(request: NextRequest) {
  try {
    const user = await requireAuth();
    const url = new URL(request.url);
    const id = url.searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Recipe ID required' }, { status: 400 });
    }

    const affected = await remove('recipes', 'id = ? AND user_id = ?', [id, user.id]);

    if (affected === 0) {
      return NextResponse.json({ error: 'Recipe not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to delete recipe' }, { status: 500 });
  }
}
