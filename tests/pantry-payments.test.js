const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PaymentBoundaryError,
  buildClientReferenceId,
  createCheckoutSession,
  getPaymentConfiguration,
  getPaymentPresentation,
  matchesPaymentIdentity,
  verifyCheckout,
} = require('../lib/pantry-payments');
const {
  fulfillVerifiedCheckout,
  hasPaidEntitlement,
  getPendingCheckout,
} = require('../db/pantry-payments');

const configuredEnv = {
  POLSIA_API_BASE_URL: 'https://polsia.example',
  POLSIA_API_KEY: 'real-test-key',
  APP_URL: 'https://pantry.example',
  PANTRY_OFFERING_NAME: 'Pantry Plus',
  PANTRY_OFFERING_AMOUNT_USD: '14.50',
  PANTRY_OFFERING_INTERVAL: 'month',
};

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(body); },
  };
}

test('payment configuration requires every owner value and invents no defaults', () => {
  const missing = getPaymentConfiguration({});
  assert.equal(missing.valid, false);
  assert.ok(missing.missing.includes('POLSIA_API_BASE_URL'));
  assert.ok(missing.missing.includes('POLSIA_API_KEY'));
  assert.ok(missing.missing.includes('PANTRY_OFFERING_NAME'));
  assert.ok(missing.missing.includes('PANTRY_OFFERING_AMOUNT_USD'));
  assert.ok(missing.missing.includes('PANTRY_OFFERING_INTERVAL'));
  assert.equal(getPaymentPresentation({}, {}).available, false);
});

test('checkout uses server configuration for the ordinary authenticated account', async () => {
  const config = getPaymentConfiguration(configuredEnv);
  const calls = [];
  const checkout = await createCheckoutSession({
    user: { id: 41, email: 'unpaid@example.com' },
    config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response({ id: 'cs_pan_41', url: 'https://checkout.example/session/cs_pan_41' });
    },
  });

  assert.equal(checkout.sessionId, 'cs_pan_41');
  assert.equal(checkout.checkoutUrl, 'https://checkout.example/session/cs_pan_41');
  const payload = JSON.parse(calls[0].options.body);
  assert.equal(payload.amount, 14.5);
  assert.equal(payload.interval, 'month');
  assert.equal(payload.product_name, 'Pantry Plus');
  assert.equal(payload.client_reference_id, buildClientReferenceId(41));
  assert.match(payload.success_url, /CHECKOUT_SESSION_ID/);
  assert.equal(payload.cancel_url, 'https://pantry.example/profile');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer real-test-key');
  assert.equal(calls[0].url, 'https://polsia.example/api/v2/app-payments/checkout-session');
});

test('missing platform setup returns a blocker and no checkout URL', async () => {
  const config = getPaymentConfiguration({ ...configuredEnv, POLSIA_API_KEY: '' });
  await assert.rejects(
    () => createCheckoutSession({ user: { id: 41 }, config, fetchImpl: async () => response({}) }),
    (error) => error instanceof PaymentBoundaryError && error.code === 'payment_setup_required'
  );
});

test('unverified, mismatched, and other-user payment records never match', async () => {
  const config = getPaymentConfiguration(configuredEnv);
  const unverified = await verifyCheckout({
    sessionId: 'cs_pending',
    config,
    fetchImpl: async () => response({ status: 'pending', client_reference_id: buildClientReferenceId(41) }),
  });
  assert.equal(unverified.verified, false);
  assert.equal(matchesPaymentIdentity({ status: 'paid', client_reference_id: buildClientReferenceId(99) }, 41), false);
  assert.equal(matchesPaymentIdentity({ status: 'paid' }, 41), false);
  assert.equal(matchesPaymentIdentity({ status: 'paid', client_reference_id: buildClientReferenceId(41) }, 41), true);
});

test('a session lookup is constrained by both checkout session and authenticated user', async () => {
  const calls = [];
  const database = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [] };
    },
  };
  assert.equal(await getPendingCheckout('cs_other', 41, database), null);
  assert.deepEqual(calls[0].params, ['cs_other', 41]);
  assert.match(calls[0].sql, /checkout_session_id = \$1/);
  assert.match(calls[0].sql, /user_id = \$2/);
});

test('verified fulfillment is idempotent and unpaid accounts remain denied', async () => {
  const state = {
    checkout: {
      checkout_session_id: 'cs_paid_41',
      user_id: 41,
      offering_key: 'Pantry Plus:14.50:month',
      offering_name: 'Pantry Plus',
      amount_usd: '14.50',
      interval: 'month',
      status: 'pending',
    },
    entitlements: [],
    inserts: 0,
  };
  const client = {
    async query(sql, params) {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (/SELECT \* FROM pantry_payment_checkouts/.test(sql)) {
        return params[1] === 41 ? { rows: [state.checkout] } : { rows: [] };
      }
      if (/INSERT INTO pantry_paid_entitlements/.test(sql)) {
        state.inserts += 1;
        if (!state.entitlements.length) state.entitlements.push({ user_id: 41, offering_key: state.checkout.offering_key });
        return { rows: [] };
      }
      if (/UPDATE pantry_payment_checkouts/.test(sql)) {
        state.checkout.status = 'fulfilled';
        return { rows: [] };
      }
      if (/SELECT \* FROM pantry_paid_entitlements/.test(sql)) return { rows: state.entitlements };
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() {},
  };
  const database = { async connect() { return client; } };

  const first = await fulfillVerifiedCheckout({ checkoutSessionId: 'cs_paid_41', userId: 41, verified: true, database });
  const second = await fulfillVerifiedCheckout({ checkoutSessionId: 'cs_paid_41', userId: 41, verified: true, database });
  assert.equal(first.accessGranted, true);
  assert.equal(second.accessGranted, true);
  assert.equal(state.entitlements.length, 1);
  assert.equal(state.inserts, 1);
  assert.equal(await fulfillVerifiedCheckout({ checkoutSessionId: 'cs_paid_41', userId: 99, verified: true, database }).then(result => result.accessGranted), false);

  const unpaidDatabase = { async query() { return { rows: [] }; } };
  assert.equal(await hasPaidEntitlement(99, state.checkout.offering_key, unpaidDatabase), false);
});
