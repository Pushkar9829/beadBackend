const express = require('express');
const ctrl = require('../controllers/kundliController');
const { requireAuth } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');

const router = express.Router();

// Every Kundli route is for signed-in users (the home modal asks signed-out visitors to sign in).
// Place search costs an AstrologyAPI call per uncached query: per-IP limit here, plus a global daily cap
// on new lookups (KUNDLI_PLACES_DAILY_CAP) in the service. Staff use it from the admin drawer too.
const placeLimit = rateLimit({ windowMs: 60 * 1000, max: 20, message: 'Too many place searches. Please wait a moment.' });
const perUser = (max) => rateLimit({ windowMs: 60 * 1000, max, key: (req) => String(req.user?._id || req.ip) });

router.get('/places', placeLimit, requireAuth, ctrl.places);
router.get('/mine', requireAuth, ctrl.mine);
router.put('/details', requireAuth, perUser(10), ctrl.saveMine);
router.post('/retry', requireAuth, perUser(5), ctrl.retryMine);

module.exports = router;
