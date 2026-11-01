const PAYMENT_PATHS = {
  checkout: '/api/v2/app-payments/checkout-session',
  verify: '/api/company-payments/verify',
  subscriptionStatus: '/api/company-payments/subscription-status',
};

const INTERVALS = new Set(['one_time', 'month', 'year']);

class PaymentBoundaryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PaymentBoundaryError';
    this.code = code;
    this.details = details;
  }
}

function trimEnv(env, key) {
  const value = env && env[key];
  return typeof value === 'string' ? value.trim() : '';
}

function getPaymentConfiguration(env = process.env) {
  const baseUrl = trimEnv(env, 'POLSIA_API_BASE_URL').replace(/\/+$/, '');
  const apiKey = trimEnv(env, 'POLSIA_API_KEY');
  const appUrl = trimEnv(env, 'APP_URL').replace(/\/+$/, '');
  const name = trimEnv(env, 'PANTRY_OFFERING_NAME');
  const amountText = trimEnv(env, 'PANTRY_OFFERING_AMOUNT_USD');
  const interval = trimEnv(env, 'PANTRY_OFFERING_INTERVAL');
  const missing = [];

  if (!baseUrl) missing.push('POLSIA_API_BASE_URL');
  if (!apiKey) missing.push('POLSIA_API_KEY');
  if (!appUrl) missing.push('APP_URL');
  if (!name) missing.push('PANTRY_OFFERING_NAME');
  if (!amountText) missing.push('PANTRY_OFFERING_AMOUNT_USD');
  if (!interval) missing.push('PANTRY_OFFERING_INTERVAL');

  let parsedBaseUrl;
  try {
    parsedBaseUrl = new URL(baseUrl);
    if (!['http:', 'https:'].includes(parsedBaseUrl.protocol)) throw new Error('unsupported protocol');
  } catch (_err) {
    if (baseUrl) missing.push('POLSIA_API_BASE_URL');
  }

  let parsedAppUrl;
  try {
    parsedAppUrl = new URL(appUrl);
    if (!['http:', 'https:'].includes(parsedAppUrl.protocol)) throw new Error('unsupported protocol');
  } catch (_err) {
    if (appUrl) missing.push('APP_URL');
  }

  const amount = Number(amountText);
  if (amountText && (!/^\d+(\.\d{1,2})?$/.test(amountText) || !Number.isFinite(amount) || amount <= 0)) {
    missing.push('PANTRY_OFFERING_AMOUNT_USD');
  }
  if (interval && !INTERVALS.has(interval)) missing.push('PANTRY_OFFERING_INTERVAL');

  if (missing.length > 0) {
    return {
      valid: false,
      missing: [...new Set(missing)],
      blocker: 'Payment setup is unavailable until the owner completes payment configuration.',
    };
  }

  const normalizedAmount = amount.toFixed(2);
  return {
    valid: true,
    baseUrl,
    apiKey,
    appUrl,
    offering: {
      name,
      amountUsd: amount,
      amountText: normalizedAmount,
      interval,
      intervalLabel: interval === 'one_time' ? 'one-time' : interval === 'month' ? 'monthly' : 'yearly',
      key: `${name}:${normalizedAmount}:${interval}`,
    },
  };
}

function getConfigurationStatus(env = process.env) {
  const config = getPaymentConfiguration(env);
  return config.valid
    ? { configured: true, blocker: null }
    : { configured: false, blocker: config.blocker, missing: config.missing };
}

function getPaymentPresentation(_user, env = process.env) {
  const config = getPaymentConfiguration(env);
  if (!config.valid) {
    return {
      available: false,
      blocker: config.blocker,
    };
  }
  return {
    available: true,
    offering: config.offering,
  };
}

function buildClientReferenceId(userId) {
  return `pantry-user-${String(userId)}`;
}

async function readResponseBody(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (_err) {
    return { raw: text };
  }
}

function responseCode(body) {
  return body && (body.code || body.error_code || body.error?.code || body.error);
}

function isSetupCode(code) {
  return code === 'stripe_not_configured' || code === 'stripe_not_onboarded';
}

function setupError(details = {}) {
  return new PaymentBoundaryError(
    'payment_setup_required',
    'Checkout is unavailable until payment setup is completed.',
    details
  );
}

async function callPaymentApi(path, { method = 'GET', body, config, fetchImpl = globalThis.fetch, query } = {}) {
  if (!config || !config.valid) throw setupError({ reason: 'invalid_configuration' });
  const queryString = query ? `?${new URLSearchParams(query).toString()}` : '';
  const response = await fetchImpl(`${config.baseUrl}${path}${queryString}`, {
    method,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const responseBody = await readResponseBody(response);
  const code = responseCode(responseBody);

  if (!response.ok && isSetupCode(code)) throw setupError({ platformCode: code });
  if (!response.ok) {
    throw new PaymentBoundaryError('payment_platform_error', 'The payment service could not complete the request.', {
      status: response.status,
      platformCode: typeof code === 'string' ? code : undefined,
    });
  }
  return responseBody;
}

function checkoutUrlFrom(body) {
  const candidate = body && (
    body.checkout_url || body.checkoutUrl || body.url ||
    body.session?.url || body.checkout_session?.url || body.data?.url
  );
  if (typeof candidate !== 'string') return null;
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch (_err) {
    return null;
  }
}

function sessionIdFrom(body) {
  const value = body && (
    body.checkout_session_id || body.checkoutSessionId || body.session_id ||
    body.sessionId || body.id || body.session?.id || body.checkout_session?.id || body.data?.id
  );
  return typeof value === 'string' && value.length > 0 && value.length <= 255 ? value : null;
}

async function createCheckoutSession({ user, config = getPaymentConfiguration(), fetchImpl = globalThis.fetch } = {}) {
  if (!user || !Number.isSafeInteger(Number(user.id)) || Number(user.id) < 1) {
    throw new PaymentBoundaryError('invalid_account', 'A signed-in account is required.');
  }
  if (!config.valid) throw setupError({ reason: 'invalid_configuration' });

  const successUrl = `${config.appUrl}/payments/success?session_id={CHECKOUT_SESSION_ID}`;
  const payload = {
    amount: config.offering.amountUsd,
    currency: 'usd',
    product_name: config.offering.name,
    interval: config.offering.interval,
    mode: config.offering.interval === 'one_time' ? 'payment' : 'subscription',
    success_url: successUrl,
    cancel_url: `${config.appUrl}/profile`,
    client_reference_id: buildClientReferenceId(user.id),
  };
  if (typeof user.email === 'string' && user.email.trim()) payload.customer_email = user.email.trim();

  const responseBody = await callPaymentApi(PAYMENT_PATHS.checkout, {
    method: 'POST', body: payload, config, fetchImpl,
  });
  const checkoutUrl = checkoutUrlFrom(responseBody);
  const sessionId = sessionIdFrom(responseBody);
  if (!checkoutUrl || !sessionId) {
    throw new PaymentBoundaryError('payment_platform_error', 'The payment service returned an incomplete checkout.', {
      missing: [!checkoutUrl ? 'checkout_url' : null, !sessionId ? 'session_id' : null].filter(Boolean),
    });
  }
  return { checkoutUrl, sessionId, payload, offering: config.offering };
}

function verificationParts(body) {
  const parts = [body, body?.data, body?.session, body?.checkout_session, body?.payment].filter(Boolean);
  return parts;
}

function isVerifiedPayment(body) {
  return verificationParts(body).some((part) =>
    part.verified === true || part.paid === true ||
    ['paid', 'succeeded', 'complete', 'completed'].includes(String(part.payment_status || part.status || '').toLowerCase())
  );
}

function paymentIdentity(body) {
  const parts = verificationParts(body);
  for (const part of parts) {
    const reference = part.client_reference_id || part.clientReferenceId || part.reference_id || part.referenceId ||
      part.metadata?.client_reference_id;
    if (reference !== undefined && reference !== null) return { type: 'reference', value: String(reference) };
    const userId = part.user_id || part.userId || part.metadata?.user_id || part.metadata?.pantry_user_id;
    if (userId !== undefined && userId !== null) return { type: 'user_id', value: String(userId) };
  }
  return null;
}

function matchesPaymentIdentity(body, userId) {
  const identity = paymentIdentity(body);
  if (!identity) return false;
  return (identity.type === 'reference' && identity.value === buildClientReferenceId(userId)) ||
    (identity.type === 'user_id' && identity.value === String(userId));
}

async function verifyCheckout({ sessionId, config = getPaymentConfiguration(), fetchImpl = globalThis.fetch } = {}) {
  if (typeof sessionId !== 'string' || !/^[A-Za-z0-9_\-.:]+$/.test(sessionId) || sessionId.length > 255) {
    return { verified: false, invalid: true };
  }
  try {
    const body = await callPaymentApi(PAYMENT_PATHS.verify, {
      config, fetchImpl, query: { session_id: sessionId },
    });
    return { verified: isVerifiedPayment(body), identity: paymentIdentity(body), body };
  } catch (err) {
    if (err instanceof PaymentBoundaryError && err.code === 'payment_platform_error' && [404, 409].includes(err.details.status)) {
      return { verified: false, pending: true };
    }
    throw err;
  }
}

async function getSubscriptionStatus({ userId, email, config = getPaymentConfiguration(), fetchImpl = globalThis.fetch } = {}) {
  if (!Number.isSafeInteger(Number(userId)) || Number(userId) < 1) {
    throw new PaymentBoundaryError('invalid_account', 'A signed-in account is required.');
  }
  const query = { user_id: String(userId) };
  if (typeof email === 'string' && email.trim()) query.customer_email = email.trim();
  return callPaymentApi(PAYMENT_PATHS.subscriptionStatus, { config, fetchImpl, query });
}

function hasActiveSubscription(statusBody) {
  return verificationParts(statusBody).some((part) => ['active', 'trialing'].includes(String(part.status || part.subscription_status || '').toLowerCase()));
}

module.exports = {
  PAYMENT_PATHS,
  PaymentBoundaryError,
  buildClientReferenceId,
  createCheckoutSession,
  getConfigurationStatus,
  getPaymentConfiguration,
  getPaymentPresentation,
  getSubscriptionStatus,
  hasActiveSubscription,
  matchesPaymentIdentity,
  verifyCheckout,
};
