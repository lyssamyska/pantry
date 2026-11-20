const express = require('express');
const usersDb = require('../db/users');
const { AuthError, registerUser, authenticateUser } = require('../lib/auth');
const { setSessionCookie, clearSessionCookie } = require('../lib/session');

const router = express.Router();

router.post('/register', async (req, res) => {
  const { email, password } = req.body || {};
  try {
    const user = await registerUser(email, password, usersDb);
    setSessionCookie(res, user.id);
    res.status(201).json({ success: true });
  } catch (err) {
    if (err instanceof AuthError) return res.status(err.status).json({ success: false, message: err.message });
    console.error('[auth/register]', err);
    res.status(500).json({ success: false, message: 'Could not create your account. Please try again.' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  try {
    const user = await authenticateUser(email, password, usersDb);
    if (!user) return res.status(401).json({ success: false, message: 'Email or password is incorrect.' });
    setSessionCookie(res, user.id);
    res.json({ success: true });
  } catch (err) {
    console.error('[auth/login]', err);
    res.status(500).json({ success: false, message: 'Sign-in failed. Please try again.' });
  }
});

router.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ success: true });
});

module.exports = router;
