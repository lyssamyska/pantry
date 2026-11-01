const { hasPaidEntitlement } = require('../db/pantry-payments');
const { getPaymentConfiguration } = require('./pantry-payments');
const { getUserIdFromCookie } = require('./user-session');

async function getConfiguredPaidAccess(userId, {
  getConfiguration = getPaymentConfiguration,
  checkEntitlement = hasPaidEntitlement,
} = {}) {
  const config = getConfiguration();
  if (!userId || !config.valid || !config.offering?.key) {
    return { configured: false, hasAccess: false, offeringKey: null };
  }

  const hasAccess = await checkEntitlement(userId, config.offering.key);
  return { configured: true, hasAccess, offeringKey: config.offering.key };
}

function paidAccessRequired(res, status) {
  return res.status(status).json({
    error: 'paid_access_required',
    code: 'paid_access_required',
    message: 'A paid Pantry account is required.',
  });
}

function createRequirePaidAccess(options = {}) {
  return async function requirePaidAccess(req, res, next) {
    const userId = getUserIdFromCookie(req);
    if (!userId) return paidAccessRequired(res, 401);

    try {
      const access = await getConfiguredPaidAccess(userId, options);
      if (!access.configured) return paidAccessRequired(res, 503);
      if (!access.hasAccess) return paidAccessRequired(res, 403);
      req.authenticatedUserId = userId;
      return next();
    } catch (err) {
      console.error('[paid-access] entitlement lookup failed:', err.message || err);
      return paidAccessRequired(res, 503);
    }
  };
}

function rejectMismatchedUserId(req, res, next) {
  const userId = req.authenticatedUserId;
  const supplied = [];
  if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'userId')) supplied.push(req.body.userId);
  if (req.query && Object.prototype.hasOwnProperty.call(req.query, 'userId')) supplied.push(req.query.userId);

  if (supplied.some((value) => {
    if ((typeof value !== 'string' && typeof value !== 'number') || String(value).trim() === '') return true;
    const parsed = Number(value);
    return !Number.isSafeInteger(parsed) || parsed !== userId;
  })) {
    return res.status(403).json({ error: 'userId does not match the authenticated account' });
  }
  return next();
}

function userIdMatchesAuthenticatedAccount(req, userId) {
  if ((typeof userId !== 'string' && typeof userId !== 'number') || String(userId).trim() === '') return false;
  const parsed = Number(userId);
  return Number.isSafeInteger(parsed) && parsed === req.authenticatedUserId;
}

const requirePaidAccess = createRequirePaidAccess();

module.exports = {
  createRequirePaidAccess,
  getConfiguredPaidAccess,
  rejectMismatchedUserId,
  requirePaidAccess,
  userIdMatchesAuthenticatedAccount,
};
