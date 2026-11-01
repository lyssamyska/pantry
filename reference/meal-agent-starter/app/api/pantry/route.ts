import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, insert, remove, table } from '@/lib/db';

// GET /api/pantry
export async function GET() {
  try {
    const user = await requireAuth();
    const items = await query(
      `SELECT * FROM ${table('pantry')} WHERE user_id = ? ORDER BY expires_at ASC, name ASC`,
      [user.id]
    );
    return NextResponse.json({ items });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

// POST /api/pantry
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth();
    const body = await request.json();

    const id = await insert('pantry', {
      user_id: user.id,
      name: body.name,
      quantity: body.quantity || null,
      category: body.category || 'other',
      expires_at: body.expiresAt || null,
    });

    return NextResponse.json({ id }, { status: 201 });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

// DELETE /api/pantry?id=123
export async function DELETE(request: NextRequest) {
  try {
    const user = await requireAuth();
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 });

    await remove('pantry', 'id = ? AND user_id = ?', [id, user.id]);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
