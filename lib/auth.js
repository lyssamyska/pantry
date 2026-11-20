// Email + password authentication. Ported from
// reference/meal-agent-starter/lib/auth.ts (bcrypt hashing, register/login),
// adapted to Pantry's Postgres users table. Sessions live in lib/session.js.
const bcrypt = require('bcryptjs');

const BCRYPT_ROUNDS = 12;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 72; // bcrypt ignores bytes past 72

// Compared against when the email is unknown, so a login attempt takes the
// same time whether or not the account exists.
const DUMMY_HASH = bcrypt.hashSync('pantry-timing-placeholder', BCRYPT_ROUNDS);

function normalizeEmail(email) {
  if (typeof email !== 'string') return null;
  const trimmed = email.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) && trimmed.length <= 255 ? trimmed : null;
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_LENGTH) {
    return `Password must be at most ${MAX_PASSWORD_LENGTH} bytes.`;
  }
  return null;
}

function hashPassword(password, rounds = BCRYPT_ROUNDS) {
  return bcrypt.hash(password, rounds);
}

function verifyPassword(password, hash) {
  if (typeof password !== 'string' || typeof hash !== 'string' || !hash) return Promise.resolve(false);
  return bcrypt.compare(password, hash);
}

class AuthError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// usersDb must provide getUserByEmail(email) and createUser(email, hash).
async function registerUser(email, password, usersDb, { rounds } = {}) {
  const normalized = normalizeEmail(email);
  if (!normalized) throw new AuthError('Enter a valid email address.', 400);
  const passwordError = validatePassword(password);
  if (passwordError) throw new AuthError(passwordError, 400);

  // Existing accounts (including old OTP accounts with no password) can't be
  // claimed by registering — set their password with `npm run set-password`.
  if (await usersDb.getUserByEmail(normalized)) {
    throw new AuthError('An account with that email already exists. Sign in instead.', 409);
  }
  return usersDb.createUser(normalized, await hashPassword(password, rounds));
}

// Returns the user row on success, null on any failure.
async function authenticateUser(email, password, usersDb) {
  const normalized = normalizeEmail(email);
  const user = normalized ? await usersDb.getUserByEmail(normalized) : null;
  const hash = user && user.password_hash ? user.password_hash : DUMMY_HASH;
  const valid = await verifyPassword(typeof password === 'string' ? password : '', hash);
  return user && user.password_hash && valid ? user : null;
}

module.exports = {
  AuthError,
  BCRYPT_ROUNDS,
  MIN_PASSWORD_LENGTH,
  normalizeEmail,
  validatePassword,
  hashPassword,
  verifyPassword,
  registerUser,
  authenticateUser,
};
