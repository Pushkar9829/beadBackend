const express = require('express');
const auth = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');

const router = express.Router();

const loginLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many sign-in attempts. Please wait 15 minutes and try again.',
  key: (req) => `${req.ip}|${String(req.body?.email || '').toLowerCase().slice(0, 254)}`,
});
const registerLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, message: 'Too many sign-ups from this network. Try again later.' });

router.post('/register', registerLimit, auth.register);
router.post('/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 50 }), loginLimit, auth.login);
router.post('/logout', auth.logout);
router.get('/me', auth.me);
router.put('/profile', requireAuth, auth.updateProfile);

module.exports = router;
