// Client-side log intake: browser reports errors to a same-origin endpoint so
// the platform log proxy URL and bearer token stay server-only. The forwarded
// payload is shaped like a server-side Error so the same proxy destination
// receives a uniform trace.
const express = require('express');
const router = express.Router();
const { reportError } = require('../lib/polsia-log');

router.post('/client', (req, res) => {
  try {
    const { message, stack, source, url, timestamp } = req.body || {};
    const err = new Error(message || 'Unknown client error');
    if (stack) err.stack = stack;
    err.userId = (req.body && req.body.userId) || null;
    const context = `client:${source || 'unknown'} ${url || ''} @ ${timestamp || ''}`.trim();
    reportError(err, context);
  } catch (_e) {
    // Never break the client because of logging.
  }
  res.json({ ok: true });
});

module.exports = router;
