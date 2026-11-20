const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret-that-is-at-least-32-characters-long';

const auth = require('../lib/auth');
const session = require('../lib/session');

const FAST_ROUNDS = 4;

function memoryUsers() {
  const rows = [];
  return {
    rows,
    async getUserByEmail(email) { return rows.find((r) => r.email === email.toLowerCase()) || null; },
    async createUser(email, password_hash) {
      const row = { id: rows.length + 1, email, password_hash };
      rows.push(row);
      return row;
    },
  };
}

test('passwords are bcrypt-hashed and verify only with the right password', async () => {
  const hash = await auth.hashPassword('correct horse', FAST_ROUNDS);
  assert.match(hash, /^\$2[aby]\$/);
  assert.notEqual(hash, 'correct horse');
  assert.equal(await auth.verifyPassword('correct horse', hash), true);
  assert.equal(await auth.verifyPassword('wrong horse', hash), false);
  assert.equal(await auth.verifyPassword('anything', null), false);
});

test('registration normalizes email, validates input, and refuses existing accounts', async () => {
  const users = memoryUsers();
  const user = await auth.registerUser('  Me@Example.COM ', 'longenough', users, { rounds: FAST_ROUNDS });
  assert.equal(user.email, 'me@example.com');
  assert.equal(await auth.verifyPassword('longenough', users.rows[0].password_hash), true);

  await assert.rejects(auth.registerUser('me@example.com', 'anotherpass', users, { rounds: FAST_ROUNDS }), { status: 409 });
  await assert.rejects(auth.registerUser('not-an-email', 'longenough', users), { status: 400 });
  await assert.rejects(auth.registerUser('new@example.com', 'short', users), { status: 400 });
});

test('an old passwordless (OTP-era) account cannot be claimed by registering or logged into', async () => {
  const users = memoryUsers();
  users.rows.push({ id: 7, email: 'old@example.com', password_hash: null });
  await assert.rejects(auth.registerUser('old@example.com', 'longenough', users, { rounds: FAST_ROUNDS }), { status: 409 });
  assert.equal(await auth.authenticateUser('old@example.com', 'longenough', users), null);
});

test('login succeeds only with the right email and password', async () => {
  const users = memoryUsers();
  await auth.registerUser('me@example.com', 'longenough', users, { rounds: FAST_ROUNDS });
  assert.equal((await auth.authenticateUser('ME@example.com', 'longenough', users)).id, 1);
  assert.equal(await auth.authenticateUser('me@example.com', 'wrongpass', users), null);
  assert.equal(await auth.authenticateUser('nobody@example.com', 'longenough', users), null);
  assert.equal(await auth.authenticateUser(undefined, undefined, users), null);
});

test('session tokens round-trip, expire, and depend on the secret', () => {
  const now = 1_000_000;
  const token = session.createSessionToken(41, { now });
  assert.equal(session.verifySessionToken(token, { now: now + 1000 }), 41);
  assert.equal(session.verifySessionToken(token, { now: now + session.MAX_AGE_MS + 1 }), null);
  assert.equal(session.verifySessionToken(token, { now, secret: 'a-different-secret-also-32-characters!!' }), null);
  assert.equal(session.verifySessionToken('garbage', { now }), null);
  assert.equal(session.verifySessionToken(undefined, { now }), null);
});

test('session secret must be at least 32 characters', () => {
  assert.throws(() => session.getSessionSecret({}), /SESSION_SECRET/);
  assert.throws(() => session.getSessionSecret({ SESSION_SECRET: 'short' }), /SESSION_SECRET/);
  assert.equal(session.getSessionSecret({ SESSION_SECRET: 'x'.repeat(32) }), 'x'.repeat(32));
});

test('setSessionCookie writes an httpOnly signed cookie that getSessionUserId reads back', () => {
  let written;
  session.setSessionCookie({ cookie: (name, value, opts) => { written = { name, value, opts }; } }, 12);
  assert.equal(written.name, session.COOKIE_NAME);
  assert.equal(written.opts.httpOnly, true);
  assert.equal(written.opts.sameSite, 'lax');
  assert.equal(session.getSessionUserId({ headers: { cookie: `${written.name}=${encodeURIComponent(written.value)}` } }), 12);
});

function startServer(env) {
  return spawnSync(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { PATH: process.env.PATH, PANTRY_SKIP_ENV_FILES: '1', ...env },
    encoding: 'utf8',
    timeout: 10000,
  });
}

test('server refuses to start without SESSION_SECRET and needs no Polsia variables', () => {
  const noSecret = startServer({ DATABASE_URL: 'postgres://u:p@127.0.0.1:1/none' });
  assert.equal(noSecret.status, 1);
  assert.match(noSecret.stderr, /SESSION_SECRET/);

  // With only DATABASE_URL + SESSION_SECRET it passes config checks and gets as far
  // as connecting to the (unreachable) database — no Polsia variable is asked for.
  const configured = startServer({
    DATABASE_URL: 'postgres://u:p@127.0.0.1:1/none',
    SESSION_SECRET: 'x'.repeat(32),
  });
  const output = configured.stdout + configured.stderr;
  assert.match(output, /Running migrations/);
  assert.doesNotMatch(output, /POLSIA|SESSION_SECRET must/);
});
