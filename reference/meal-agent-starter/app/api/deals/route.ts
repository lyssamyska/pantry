import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, table } from '@/lib/db';

// GET /api/deals — Get active compliant deals
export async function GET() {
  try {
    await requireAuth();

    const deals = await query(
      `SELECT * FROM ${table('deals')} 
       WHERE expires_at >= CURDATE() 
       ORDER BY compliant DESC, expires_at ASC`
    );

    return NextResponse.json({
      deals,
      summary: {
        total: deals.length,
        compliant: deals.filter((d: any) => d.compliant).length,
        filtered: deals.filter((d: any) => !d.compliant).length,
      },
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
