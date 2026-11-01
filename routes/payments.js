const express = require('express');
const { getUserById } = require('../db/users');
const paymentsDb = require('../db/pantry-payments');
const { getUserIdFromCookie } = require('../lib/user-session');
const {
  PaymentBoundaryError,
  createCheckoutSession,
  getPaymentConfiguration,
  matchesPaymentIdentity,
  verifyCheckout,
} = require('../lib/pantry-payments');

const router = express.Router();

function blockerResponse(res, status = 503) {
  return res.status(status).json({
    success: false,
    verified: false,
    code: 'payment_setup_required',
    message: 'Checkout is currently unavailable while payment setup is completed.',
  });
}

function logPaymentBlocker(context, err) {
  console.error(`[payments/${context}]`, err?.code || 'payment_error', err?.details || err?.message || err);
}

router.post('/checkout', async (req, res) => {
  const userId = getUserIdFromCookie(req);
  if (!userId) return res.status(401).json({ success: false, message: 'Sign in to continue to checkout.' });

  const config = getPaymentConfiguration();
  if (!config.valid) {
    console.error('[payments/checkout] configuration blocker', config.missing);
    return blockerResponse(res);
  }

  try {
    const user = await getUserById(userId);
    if (!user) return res.status(401).json({ success: false, message: 'Sign in to continue to checkout.' });

    const checkout = await createCheckoutSession({ user, config });
    const pending = await paymentsDb.createPendingCheckout({
      userId,
      checkoutSessionId: checkout.sessionId,
      offeringKey: checkout.offering.key,
      offeringName: checkout.offering.name,
      amountUsd: checkout.offering.amountUsd,
      interval: checkout.offering.interval,
    });
    if (!pending) {
      console.error('[payments/checkout] could not persist pending checkout', { userId, sessionId: checkout.sessionId });
      return res.status(502).json({ success: false, message: 'Checkout could not be started. Please try again.' });
    }

    return res.json({ success: true, checkoutUrl: checkout.checkoutUrl });
  } catch (err) {
    logPaymentBlocker('checkout', err);
    if (err instanceof PaymentBoundaryError && err.code === 'payment_setup_required') return blockerResponse(res);
    return res.status(502).json({ success: false, message: 'Checkout could not be started. Please try again.' });
  }
});

router.get('/success', (_req, res) => {
  res.render('payment-success', { title: 'Confirming your Pantry access — Pantry' });
});

router.get('/poll', async (req, res) => {
  const userId = getUserIdFromCookie(req);
  if (!userId) return res.status(401).json({ verified: false, message: 'Sign in to verify this checkout.' });

  const sessionId = typeof req.query.session_id === 'string' ? req.query.session_id : '';
  if (!/^[A-Za-z0-9_\-.:]{1,255}$/.test(sessionId)) {
    return res.status(400).json({ verified: false, message: 'This checkout session is not valid.' });
  }

  try {
    const pending = await paymentsDb.getPendingCheckout(sessionId, userId);
    if (!pending) {
      return res.status(404).json({ verified: false, message: 'This checkout is not available for this account.' });
    }

    const config = getPaymentConfiguration();
    if (!config.valid) {
      console.error('[payments/poll] configuration blocker', config.missing);
      return blockerResponse(res);
    }

    const verification = await verifyCheckout({ sessionId, config });
    if (!verification.verified) {
      return res.json({ verified: false, state: verification.pending ? 'pending' : 'unverified' });
    }
    if (!matchesPaymentIdentity(verification.body, userId)) {
      console.error('[payments/poll] payment identity mismatch', { userId, sessionId });
      return res.json({ verified: false, state: 'mismatch' });
    }

    const fulfillment = await paymentsDb.fulfillVerifiedCheckout({
      checkoutSessionId: sessionId,
      userId,
      verified: true,
    });
    return res.json({
      verified: true,
      accessGranted: fulfillment.accessGranted === true,
      status: fulfillment.accessGranted ? 'fulfilled' : 'unavailable',
    });
  } catch (err) {
    logPaymentBlocker('poll', err);
    if (err instanceof PaymentBoundaryError && err.code === 'payment_setup_required') return blockerResponse(res);
    return res.status(502).json({ verified: false, message: 'Payment verification is temporarily unavailable.' });
  }
});

module.exports = router;
