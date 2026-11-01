// Route guards: require a signed-in user and make sure any userId the browser
// sends matches that user. (Replaces the old Polsia paid-access gate.)
const { getUserIdFromCookie } = require('./user-session');

function authRequired(res) {
  return res.status(401).json({
    error: 'auth_required',
    code: 'auth_required',
    message: 'Sign in to use Pantry.',
  });
}

function createRequireAuth({ getUserId = getUserIdFromCookie } = {}) {
  return function requireAuth(req, res, next) {
    const userId = getUserId(req);
    if (!userId) return authRequired(res);
    req.authenticatedUserId = userId;
    return next();
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

const requireAuth = createRequireAuth();

module.exports = {
  createRequireAuth,
  rejectMismatchedUserId,
  requireAuth,
  userIdMatchesAuthenticatedAccount,
};
