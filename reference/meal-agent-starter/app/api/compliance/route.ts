import { NextRequest, NextResponse } from 'next/server';
import { checkCompliance } from '@/lib/compliance';

// POST /api/compliance/check — Check ingredients for dietary compliance
// Public endpoint (no auth required) — useful for quick checks
export async function POST(request: NextRequest) {
  try {
    const { ingredients } = await request.json();

    if (!Array.isArray(ingredients) || ingredients.length === 0) {
      return NextResponse.json({ error: 'Provide an array of ingredient strings' }, { status: 400 });
    }

    const result = checkCompliance(ingredients);

    return NextResponse.json({
      compliant: result.compliant,
      warnings: result.warnings,
      scanned: ingredients.length,
      rules: {
        avoids: 'gluten, sugar, and all variants',
        protein: 'beef=grass-fed, chicken/turkey=free-range, fish/seafood=wild-caught',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}
