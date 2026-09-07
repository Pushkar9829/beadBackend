const express = require('express');
const auth = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.post('/register', auth.register);
router.post('/login', auth.login);
router.post('/logout', auth.logout);
router.get('/me', auth.me);
router.put('/profile', requireAuth, auth.updateProfile);

module.exports = router;
