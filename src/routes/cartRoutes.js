const express = require('express');
const ctrl = require('../controllers/cartController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);
router.get('/', ctrl.getCart);
router.post('/items', ctrl.addItem);
router.patch('/items/:itemId', ctrl.updateItem);
router.delete('/items/:itemId', ctrl.removeItem);
router.delete('/', ctrl.clearCart);
router.post('/merge', ctrl.mergeCart);
router.post('/coupon', ctrl.applyCoupon);
router.delete('/coupon', ctrl.removeCoupon);

module.exports = router;
