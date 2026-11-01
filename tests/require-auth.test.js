// Route guard tests. These replace the old paid-access tests one for one and
// keep the same security guarantees: no session → 401 before the handler runs,
// and the handler only ever sees the account from the signed session.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret-that-is-at-least-32-characters-long';

const { createRequireAuth, requireAuth, rejectMismatchedUserId } = require('../lib/require-auth');
const { COOKIE_NAME, createSessionToken } = require('../lib/session');

function makeResponse() {
  return {
    statusCode: 200,
    body: null,
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

async function runMiddleware(middleware, req) {
  const res = makeResponse();
  let nextCalled = false;
  await middleware(req, res, () => { nextCalled = true; });
  return { req, res, nextCalled };
}

test('requireAuth rejects a request with no session before the route handler runs', async () => {
  const result = await runMiddleware(requireAuth, { headers: {} });

  assert.equal(result.nextCalled, false);
  assert.equal(result.res.statusCode, 401);
  assert.equal(result.res.body.code, 'auth_required');
});

test('requireAuth rejects the old unsigned user_id cookie', async () => {
  const result = await runMiddleware(requireAuth, { headers: { cookie: 'user_id=41' } });

  assert.equal(result.nextCalled, false);
  assert.equal(result.res.statusCode, 401);
  assert.equal(result.res.body.code, 'auth_required');
});

test('requireAuth rejects a tampered or expired session cookie', async () => {
  const valid = createSessionToken(41);
  const [payload, signature] = valid.split('.');
  const forgedPayload = Buffer.from(JSON.stringify({ uid: 1, exp: Date.now() + 60000 })).toString('base64url');
  const expired = createSessionToken(41, { now: Date.now() - 31 * 24 * 60 * 60 * 1000 });

  for (const token of [`${forgedPayload}.${signature}`, `${payload}.${signature.slice(0, -2)}xx`, expired]) {
    const result = await runMiddleware(requireAuth, { headers: { cookie: `${COOKIE_NAME}=${token}` } });
    assert.equal(result.nextCalled, false, token);
    assert.equal(result.res.statusCode, 401);
  }
});

test('requireAuth uses only the signed-session account, not browser-supplied ids', async () => {
  const calls = [];
  const middleware = createRequireAuth({
    getUserId: (req) => { calls.push(req); return 41; },
  });
  const result = await runMiddleware(middleware, {
    headers: {},
    body: { userId: 99 },
    query: { userId: '99' },
  });
  assert.equal(result.nextCalled, true);
  assert.equal(result.req.authenticatedUserId, 41);
  assert.equal(calls.length, 1);

  const real = await runMiddleware(requireAuth, {
    headers: { cookie: `other=1; ${COOKIE_NAME}=${createSessionToken(41)}` },
    body: { userId: 99 },
  });
  assert.equal(real.nextCalled, true);
  assert.equal(real.req.authenticatedUserId, 41);
});

test('planner ownership rejects a browser-supplied account id that differs from authentication', () => {
  const res = makeResponse();
  let nextCalled = false;
  rejectMismatchedUserId({ authenticatedUserId: 41, body: { userId: 99 }, query: {} }, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'userId does not match the authenticated account');
});
