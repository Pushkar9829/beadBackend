const express = require('express');
const ctrl = require('../controllers/kundliController');
const { requireAuth } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');

const router = express.Router();

// Same limit as the contact form (5/hour per IP) for the signed-out modal.
const formLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, message: 'Too many submissions. Please try again later.' });
// Place search is public (signed-out modal) and costs an AstrologyAPI call per uncached query.
const placeLimit = rateLimit({ windowMs: 60 * 1000, max: 20, message: 'Too many place searches. Please wait a moment.' });
const perUser = (max) => rateLimit({ windowMs: 60 * 1000, max, key: (req) => String(req.user?._id || req.ip) });

router.get('/places', placeLimit, ctrl.places);
router.post('/details', formLimit, ctrl.savePublic);
router.get('/mine', requireAuth, ctrl.mine);
router.put('/details', requireAuth, perUser(10), ctrl.saveMine);

module.exports = router;
