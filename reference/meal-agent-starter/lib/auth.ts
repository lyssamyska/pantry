import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import { query, queryOne, insert, table } from './db';

// ═══════════════════════════════════════════════════════
// Authentication — Email/Password with JWT
// ═══════════════════════════════════════════════════════

const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_ME';
const TOKEN_EXPIRY = '30d';
const COOKIE_NAME = 'ma_session';

export interface User {
  id: number;
  email: string;
  display_name: string | null;
  created_at: string;
}

interface JwtPayload {
  userId: number;
  email: string;
}

// ── Password hashing ──────────────────────────────────
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ── JWT tokens ────────────────────────────────────────
export function createToken(user: User): string {
  return jwt.sign(
    { userId: user.id, email: user.email } as JwtPayload,
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY }
  );
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}

// ── Cookie management ─────────────────────────────────
export async function setAuthCookie(token: string) {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60, // 30 days
    path: '/',
  });
}

export async function clearAuthCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export async function getAuthCookie(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(COOKIE_NAME)?.value || null;
}

// ── User operations ───────────────────────────────────
export async function registerUser(email: string, password: string, displayName?: string): Promise<User> {
  // Check if email exists
  const existing = await queryOne(`SELECT id FROM ${table('users')} WHERE email = ?`, [email]);
  if (existing) {
    throw new Error('Email already registered');
  }

  const passwordHash = await hashPassword(password);
  const id = await insert('users', {
    email: email.toLowerCase().trim(),
    password_hash: passwordHash,
    display_name: displayName || email.split('@')[0],
  });

  return { id, email, display_name: displayName || email.split('@')[0], created_at: new Date().toISOString() };
}

export async function authenticateUser(email: string, password: string): Promise<User | null> {
  const user = await queryOne<any>(
    `SELECT id, email, password_hash, display_name, created_at FROM ${table('users')} WHERE email = ?`,
    [email.toLowerCase().trim()]
  );

  if (!user) return null;

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) return null;

  return { id: user.id, email: user.email, display_name: user.display_name, created_at: user.created_at };
}

// ── Middleware helper ─────────────────────────────────
export async function getCurrentUser(): Promise<User | null> {
  const token = await getAuthCookie();
  if (!token) return null;

  const payload = verifyToken(token);
  if (!payload) return null;

  return queryOne<User>(
    `SELECT id, email, display_name, created_at FROM ${table('users')} WHERE id = ?`,
    [payload.userId]
  );
}

// ── Auth guard for API routes ─────────────────────────
export async function requireAuth(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Unauthorized');
  }
  return user;
}
