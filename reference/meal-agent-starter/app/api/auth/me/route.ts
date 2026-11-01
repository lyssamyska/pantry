import { NextResponse } from 'next/server';
import { getCurrentUser, clearAuthCookie } from '@/lib/auth';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ user: null }, { status: 401 });
  }
  return NextResponse.json({ user: { id: user.id, email: user.email, displayName: user.display_name } });
}

// Logout
export async function DELETE() {
  await clearAuthCookie();
  return NextResponse.json({ success: true });
}
