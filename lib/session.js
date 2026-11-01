// Signed session cookie. The cookie holds { uid, exp } plus an HMAC-SHA256
// signature keyed by SESSION_SECRET, so a browser can't forge or edit it.
// Format: base64url(JSON payload) + "." + base64url(signature)
const crypto = require('crypto');

const COOKIE_NAME = 'pantry_session';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MIN_SECRET_LENGTH = 32;

function getSessionSecret(env = process.env) {
  const secret = String(env.SESSION_SECRET || '');
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`SESSION_SECRET must be set and at least ${MIN_SECRET_LENGTH} characters`);
  }
  return secret;
}

function sign(data, secret) {
  return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

function createSessionToken(userId, { secret = getSessionSecret(), now = Date.now(), maxAgeMs = MAX_AGE_MS } = {}) {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('Invalid user id');
  const payload = Buffer.from(JSON.stringify({ uid: userId, exp: now + maxAgeMs })).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

// Returns the user id for a valid, unexpired token, otherwise null.
function verifySessionToken(token, { secret = getSessionSecret(), now = Date.now() } = {}) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

  const expected = Buffer.from(sign(parts[0], secret));
  const actual = Buffer.from(parts[1]);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || !Number.isSafeInteger(payload.uid) || payload.uid <= 0) return null;
  if (!Number.isFinite(payload.exp) || payload.exp <= now) return null;
  return payload.uid;
}

function readCookie(req, name) {
  const header = String((req && req.headers && req.headers.cookie) || '');
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      try { return decodeURIComponent(part.slice(index + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

function getSessionUserId(req, options) {
  return verifySessionToken(readCookie(req, COOKIE_NAME), options);
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  };
}

function setSessionCookie(res, userId) {
  res.cookie(COOKIE_NAME, createSessionToken(userId), { ...cookieOptions(), maxAge: MAX_AGE_MS });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, cookieOptions());
}

module.exports = {
  COOKIE_NAME,
  MAX_AGE_MS,
  MIN_SECRET_LENGTH,
  getSessionSecret,
  createSessionToken,
  verifySessionToken,
  getSessionUserId,
  setSessionCookie,
  clearSessionCookie,
};
