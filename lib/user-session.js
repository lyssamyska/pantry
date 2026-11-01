// Every route reads the signed-in user through this one function.
// It only trusts the signed session cookie (see lib/session.js).
const { getSessionUserId } = require('./session');

function getUserIdFromCookie(req) {
  return getSessionUserId(req);
}

module.exports = { getUserIdFromCookie };
