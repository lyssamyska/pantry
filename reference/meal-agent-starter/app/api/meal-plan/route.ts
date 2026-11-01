import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, insert, remove, table } from '@/lib/db';

// GET /api/meal-plan?week=2026-03-09
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth();
    const weekStart = new URL(request.url).searchParams.get('week');

    if (!weekStart) {
      return NextResponse.json({ error: 'week parameter required (YYYY-MM-DD)' }, { status: 400 });
    }

    const plan = await query(
      `SELECT mp.*, r.name as recipe_name, r.protein, r.total_time_minutes, 
              r.compliant, r.ingredients, r.warnings, r.image_url
       FROM ${table('meal_plans')} mp
       JOIN ${table('recipes')} r ON r.id = mp.recipe_id
       WHERE mp.user_id = ? AND mp.week_start = ?
       ORDER BY mp.day_of_week, FIELD(mp.meal, 'Breakfast', 'Lunch', 'Dinner')`,
      [user.id, weekStart]
    );

    const parsed = plan.map((p: any) => ({
      ...p,
      ingredients: JSON.parse(p.ingredients || '[]'),
      warnings: JSON.parse(p.warnings || '[]'),
    }));

    return NextResponse.json({ weekStart, plan: parsed });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

// POST /api/meal-plan — Assign a recipe to a slot
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth();
    const { weekStart, dayOfWeek, meal, recipeId } = await request.json();

    // Upsert: delete existing then insert
    await remove('meal_plans', 'user_id = ? AND week_start = ? AND day_of_week = ? AND meal = ?',
      [user.id, weekStart, dayOfWeek, meal]);

    const id = await insert('meal_plans', {
      user_id: user.id,
      week_start: weekStart,
      day_of_week: dayOfWeek,
      meal,
      recipe_id: recipeId,
    });

    return NextResponse.json({ id }, { status: 201 });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

// DELETE /api/meal-plan?week=2026-03-09&day=0&meal=Lunch
export async function DELETE(request: NextRequest) {
  try {
    const user = await requireAuth();
    const url = new URL(request.url);
    const weekStart = url.searchParams.get('week');
    const day = url.searchParams.get('day');
    const meal = url.searchParams.get('meal');

    await remove('meal_plans', 'user_id = ? AND week_start = ? AND day_of_week = ? AND meal = ?',
      [user.id, weekStart, day, meal]);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
