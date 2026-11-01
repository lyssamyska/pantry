function getUserIdFromCookie(req) {
  const cookies = String(req.headers.cookie || '').split(';');
  const userCookie = cookies.find((cookie) => cookie.trim().startsWith('user_id='));
  if (!userCookie) return null;

  const value = userCookie.trim().slice('user_id='.length);
  if (!/^\d+$/.test(value)) return null;

  const userId = Number(value);
  return Number.isSafeInteger(userId) && userId > 0 ? userId : null;
}

module.exports = { getUserIdFromCookie };
