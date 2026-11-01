import { NextRequest, NextResponse } from 'next/server';
import { registerUser, createToken, setAuthCookie } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const { email, password, displayName } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password required' }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }

    const user = await registerUser(email, password, displayName);
    const token = createToken(user);
    await setAuthCookie(token);

    return NextResponse.json({ user: { id: user.id, email: user.email, displayName: user.display_name } });
  } catch (error: any) {
    if (error.message === 'Email already registered') {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error('Registration error:', error);
    return NextResponse.json({ error: 'Registration failed' }, { status: 500 });
  }
}
