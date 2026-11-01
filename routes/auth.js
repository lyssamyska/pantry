const express = require('express');
const { createOtp, verifyOtp, upsertUser } = require('../db/otp');

const router = express.Router();

router.post('/otp/request', async (req, res) => {
  const rawEmail = req.body && req.body.email;
  if (typeof rawEmail !== 'string' || !rawEmail.trim().includes('@')) {
    return res.status(400).json({ success: false, message: 'Valid email required' });
  }
  const email = rawEmail.trim().toLowerCase();
  try {
    const code = await createOtp(email);
    const proxyUrl = process.env.POLSIA_EMAIL_PROXY_URL ||
      `${process.env.POLSIA_API_BASE_URL}/api/proxy/email/send`;
    const token = process.env.POLSIA_API_TOKEN || process.env.POLSIA_API_KEY;
    if (!token?.trim()) {
      console.error('[auth] otp/request: POLSIA_API_TOKEN and POLSIA_API_KEY are both missing or empty');
      return res.status(500).json({ success: false, message: 'Server misconfiguration: email proxy token not set.' });
    }
    console.log('[OTP] token present:', !!token, '| token length:', token ? token.length : 0);
    console.log('[OTP] fetch options:', {
      method: 'POST',
      url: proxyUrl,
      hasAuthHeader: !!token?.trim(),
      tokenLength: token ? token.length : 0,
      bodyKeys: Object.keys(JSON.parse(JSON.stringify({ to: email, subject: '...', body: '...', html: '...' }))),
    });
    const proxyRes = await fetch(proxyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        to: email,
        subject: 'Your Pantry sign-in code',
        body: `Your Pantry sign-in code is: ${code}\n\nThis code expires in 10 minutes.`,
        html: `<p>Your Pantry sign-in code is: <strong>${code}</strong></p><p>This code expires in 10 minutes.</p>`,
      }),
    });
    if (!proxyRes.ok) {
      const errBody = await proxyRes.text();
      console.error(`[auth] otp/request proxy error: status=${proxyRes.status} url=${proxyUrl} tokenPresent=${!!token?.trim()} body=${errBody}`);
      return res.status(500).json({ success: false, message: `Failed to send code (proxy status ${proxyRes.status}). Please try again.` });
    }
    res.json({ success: true });
  } catch (err) {
    console.error(`[auth] otp/request error: baseUrl=${process.env.POLSIA_API_BASE_URL} err=${err.message}`);
    res.status(500).json({ success: false, message: 'Failed to send code. Please try again.' });
  }
});

router.post('/otp/verify', async (req, res) => {
  const rawEmail = req.body && req.body.email;
  const code = req.body && req.body.code;
  if (typeof rawEmail !== 'string' || !rawEmail.trim().includes('@') || typeof code !== 'string' || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ success: false, message: 'email and code required' });
  }
  const email = rawEmail.trim().toLowerCase();
  try {
    const valid = await verifyOtp(email, code);
    if (!valid) {
      return res.status(401).json({ success: false, message: 'Invalid or expired code.' });
    }
    const userId = await upsertUser(email);
    res.cookie('user_id', String(userId), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: 'lax',
    });
    res.json({ success: true });
  } catch (err) {
    console.error(`[auth] otp/verify error: baseUrl=${process.env.POLSIA_API_BASE_URL} err=${err.message}`);
    res.status(500).json({ success: false, message: 'Verification failed. Please try again.' });
  }
});

router.post('/logout', (_req, res) => {
  res.clearCookie('user_id', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  });
  res.json({ success: true });
});

module.exports = router;
