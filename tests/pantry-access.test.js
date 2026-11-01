const test = require('node:test');
const assert = require('node:assert/strict');
const { createRequirePaidAccess, rejectMismatchedUserId } = require('../lib/pantry-access');

const configured = {
  valid: true,
  offering: { key: 'Pantry Plus:14.50:month' },
};

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

test('paid access rejects missing authentication before checking entitlements', async () => {
  let entitlementChecks = 0;
  const middleware = createRequirePaidAccess({
    getConfiguration: () => configured,
    checkEntitlement: async () => { entitlementChecks += 1; return true; },
  });
  const result = await runMiddleware(middleware, { headers: {} });

  assert.equal(result.nextCalled, false);
  assert.equal(result.res.statusCode, 401);
  assert.equal(result.res.body.code, 'paid_access_required');
  assert.equal(entitlementChecks, 0);
});

test('paid access fails closed when offering configuration is unavailable', async () => {
  let entitlementChecks = 0;
  const middleware = createRequirePaidAccess({
    getConfiguration: () => ({ valid: false }),
    checkEntitlement: async () => { entitlementChecks += 1; return true; },
  });
  const result = await runMiddleware(middleware, { headers: { cookie: 'user_id=41' } });

  assert.equal(result.nextCalled, false);
  assert.equal(result.res.statusCode, 503);
  assert.equal(result.res.body.code, 'paid_access_required');
  assert.equal(entitlementChecks, 0);
});

test('unpaid account is denied before the route handler runs', async () => {
  const middleware = createRequirePaidAccess({
    getConfiguration: () => configured,
    checkEntitlement: async () => false,
  });
  const result = await runMiddleware(middleware, { headers: { cookie: 'user_id=41' } });

  assert.equal(result.nextCalled, false);
  assert.equal(result.res.statusCode, 403);
  assert.equal(result.res.body.code, 'paid_access_required');
});

test('entitlement lookup uses only the authenticated account and configured offering key', async () => {
  const calls = [];
  const middleware = createRequirePaidAccess({
    getConfiguration: () => configured,
    checkEntitlement: async (...args) => { calls.push(args); return true; },
  });
  const result = await runMiddleware(middleware, {
    headers: { cookie: 'user_id=41' },
    body: { userId: 99 },
    query: { userId: '99' },
  });

  assert.equal(result.nextCalled, true);
  assert.equal(result.req.authenticatedUserId, 41);
  assert.deepEqual(calls, [[41, 'Pantry Plus:14.50:month']]);
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
