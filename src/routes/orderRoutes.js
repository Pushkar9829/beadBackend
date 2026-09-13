const express = require('express');
const ctrl = require('../controllers/orderController');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.post('/', requireAuth, ctrl.create);
router.get('/mine', requireAuth, ctrl.mine);
router.get('/admin/all', requireAuth, requireAdmin, ctrl.adminList);
router.put('/admin/:id', requireAuth, requireAdmin, ctrl.adminUpdate);
router.post('/admin/:id/ship', requireAuth, requireAdmin, ctrl.adminShip);
router.post('/admin/:id/track', requireAuth, requireAdmin, ctrl.adminTrack);
router.post('/admin/:id/cancel-shipment', requireAuth, requireAdmin, ctrl.adminCancelShipment);
router.post('/:id/track', requireAuth, ctrl.customerTrack);
router.post('/:id/cashfree/verify', requireAuth, ctrl.verifyCashfree);
router.post('/:id/cashfree/retry', requireAuth, ctrl.retryCashfree);
router.post('/:id/return', requireAuth, ctrl.requestReturn);
router.get('/:id', requireAuth, ctrl.getOne);

module.exports = router;
