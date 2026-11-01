/**
 * Forwards structured error reports to the Polsia log proxy.
 *
 * Mirrors the auth proxy pattern at routes/auth.js (POLSIA_API_BASE_URL +
 * POLSIA_API_TOKEN) so platform operators can see server-side stack traces
 * without tailing local stdout, and so client-side throws can be surfaced
 * without exposing the proxy token in browser code.
 *
 * Behavior:
 * - Fire-and-forget: never awaits, never blocks the calling request.
 * - Swallows its own errors: a logging failure must never break a request.
 * - Accepts a string context plus an Error-like object (or anything with
 *   a .message / .stack; strings are accepted too).
 */

const PROXY_PATH = '/api/proxy/log';

function getProxyConfig() {
  const baseUrl = process.env.POLSIA_API_BASE_URL;
  const token = process.env.POLSIA_API_TOKEN;
  if (!baseUrl || !token?.trim()) return null;
  return { url: `${baseUrl}${PROXY_PATH}`, token: token.trim() };
}

function reportError(err, context = '') {
  try {
    const cfg = getProxyConfig();
    if (!cfg) return;

    const message = (err && (err.message || err.toString())) || String(err || 'Unknown error');
    const stack = (err && err.stack) || '';
    const userId = (err && err.userId) || null;

    const payload = {
      message,
      stack,
      context: String(context || ''),
      userId,
      timestamp: new Date().toISOString(),
    };

    fetch(cfg.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.token}`,
      },
      body: JSON.stringify(payload),
    }).catch(() => {});
  } catch (_e) {
    // Never let logging crash the caller.
  }
}

module.exports = { reportError };
