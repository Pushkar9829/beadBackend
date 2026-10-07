const express = require('express');
const ctrl = require('../controllers/orderController');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');

// Per-user throttle on order placement and carrier lookups.
const perUser = (max) => rateLimit({ windowMs: 60 * 1000, max, key: (req) => String(req.user?._id || req.ip) });

const router = express.Router();

router.post('/', requireAuth, perUser(5), ctrl.create);
router.get('/mine', requireAuth, ctrl.mine);
router.get('/admin/all', requireAuth, requireAdmin, ctrl.adminList);
router.put('/admin/:id', requireAuth, requireAdmin, ctrl.adminUpdate);
router.post('/admin/:id/ship', requireAuth, requireAdmin, ctrl.adminShip);
router.post('/admin/:id/track', requireAuth, requireAdmin, ctrl.adminTrack);
router.post('/admin/:id/cancel-shipment', requireAuth, requireAdmin, ctrl.adminCancelShipment);
router.post('/:id/track', requireAuth, perUser(10), ctrl.customerTrack);
router.post('/:id/cashfree/verify', requireAuth, perUser(20), ctrl.verifyCashfree);
router.post('/:id/cashfree/retry', requireAuth, perUser(5), ctrl.retryCashfree);
router.post('/:id/return', requireAuth, perUser(5), ctrl.requestReturn);
router.get('/:id', requireAuth, ctrl.getOne);

module.exports = router;
