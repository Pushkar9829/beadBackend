const express = require('express');
const ctrl = require('../controllers/adminController');
const commerce = require('../controllers/commerceController');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { upload } = require('../middleware/upload');

const router = express.Router();

router.use(requireAuth, requireAdmin);
router.get('/dashboard', commerce.dashboard);
router.get('/customers', commerce.customers);
router.get('/users', ctrl.users);
router.put('/users/:id', ctrl.updateUser);
router.get('/content', ctrl.content);
router.put('/content', ctrl.saveContent);
router.get('/media', ctrl.listMedia);
router.post('/media', upload.single('file'), ctrl.uploadMedia);
router.delete('/media/:id', ctrl.deleteMedia);

router.get('/collections', commerce.listCollections);
router.post('/collections', commerce.saveCollection);
router.put('/collections/:id', commerce.saveCollection);
router.delete('/collections/:id', commerce.removeCollection);

router.get('/coupons', commerce.listCoupons);
router.post('/coupons', commerce.saveCoupon);
router.put('/coupons/:id', commerce.saveCoupon);
router.delete('/coupons/:id', commerce.removeCoupon);

router.get('/offers', commerce.listOffers);
router.post('/offers', commerce.saveOffer);
router.put('/offers/:id', commerce.saveOffer);
router.delete('/offers/:id', commerce.removeOffer);

router.get('/inventory', commerce.inventory);
router.post('/inventory/adjust', commerce.adjustStock);
router.get('/inventory/history', commerce.stockHistory);

router.get('/abandoned-carts', commerce.abandonedCarts);
router.get('/settings', commerce.getSettings);
router.put('/settings', commerce.saveSettings);

module.exports = router;
