const express = require('express');
const ctrl = require('../controllers/adminController');
const commerce = require('../controllers/commerceController');
const platform = require('../controllers/platformController');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { upload } = require('../middleware/upload');

const router = express.Router();

router.use(requireAuth, requireAdmin);
router.get('/dashboard', commerce.dashboard);
router.get('/analytics', platform.analytics);
router.get('/analytics/export', platform.exportAnalytics);
router.get('/customers', commerce.customers);
router.get('/customers/:id', platform.customerProfile);
router.put('/customers/:id/groups', platform.assignGroups);
router.get('/users', ctrl.users);
router.put('/users/:id', ctrl.updateUser);
router.get('/content', ctrl.content);
router.put('/content', ctrl.saveContent);
router.get('/media', ctrl.listMedia);
router.post('/media', upload.single('file'), ctrl.uploadMedia);
router.put('/media/:id', ctrl.updateMedia);
router.post('/media/:id/replace', upload.single('file'), ctrl.replaceMedia);
router.delete('/media/:id', ctrl.deleteMedia);

router.get('/collections', commerce.listCollections);
router.post('/collections', commerce.saveCollection);
router.put('/collections/:id', commerce.saveCollection);
router.delete('/collections/:id', commerce.removeCollection);

router.get('/coupons', commerce.listCoupons);
router.post('/coupons', commerce.saveCoupon);
router.put('/coupons/:id', commerce.saveCoupon);
router.delete('/coupons/:id', commerce.removeCoupon);
router.get('/coupons/:id/usage', commerce.couponUsage);

router.get('/offers', commerce.listOffers);
router.post('/offers', commerce.saveOffer);
router.put('/offers/:id', commerce.saveOffer);
router.delete('/offers/:id', commerce.removeOffer);

router.get('/inventory', commerce.inventory);
router.post('/inventory/adjust', commerce.adjustStock);
router.get('/inventory/history', commerce.stockHistory);

router.get('/abandoned-carts', commerce.abandonedCarts);
router.post('/abandoned-carts/:id/remind', platform.remindAbandoned);
router.get('/settings', commerce.getSettings);
router.put('/settings', commerce.saveSettings);

router.get('/attributes', platform.listAttributes);
router.post('/attributes', platform.saveAttribute);
router.put('/attributes/:id', platform.saveAttribute);
router.delete('/attributes/:id', platform.removeAttribute);

router.get('/banners', platform.listBanners);
router.post('/banners', platform.saveBanner);
router.put('/banners/:id', platform.saveBanner);
router.delete('/banners/:id', platform.removeBanner);

router.get('/flash-sales', platform.listFlashSales);
router.post('/flash-sales', platform.saveFlashSale);
router.put('/flash-sales/:id', platform.saveFlashSale);
router.delete('/flash-sales/:id', platform.removeFlashSale);
router.get('/flash-sales/:id/performance', platform.flashPerformance);

router.get('/faqs', platform.listFaqsAdmin);
router.post('/faqs', platform.saveFaq);
router.put('/faqs/:id', platform.saveFaq);
router.delete('/faqs/:id', platform.removeFaq);

router.get('/blog', platform.listBlogAdmin);
router.post('/blog', platform.saveBlog);
router.put('/blog/:id', platform.saveBlog);
router.delete('/blog/:id', platform.removeBlog);

router.get('/newsletter', platform.listNewsletter);
router.get('/newsletter/export', platform.exportNewsletter);
router.get('/contacts', platform.listContacts);

router.get('/groups', platform.listGroups);
router.post('/groups', platform.saveGroup);
router.put('/groups/:id', platform.saveGroup);
router.delete('/groups/:id', platform.removeGroup);

router.get('/pincodes', platform.listPincodes);
router.post('/pincodes', platform.savePincode);
router.put('/pincodes/:id', platform.savePincode);
router.delete('/pincodes/:id', platform.removePincode);

router.get('/notifications', platform.listNotifications);
router.post('/notifications/read-all', platform.markAllNotificationsRead);
router.post('/notifications/:id/read', platform.markNotificationRead);

router.get('/featured', platform.featuredList);
router.put('/featured/reorder', platform.featuredReorder);
router.put('/featured/:id', platform.setFeatured);

router.get('/returns', platform.listReturns);
router.put('/returns/:id', platform.updateReturn);
router.post('/returns/:id/pickup', platform.bookReturnPickup);
router.get('/ithink/warehouses', platform.ithinkWarehouses);
router.get('/webhooks', require('../controllers/webhookController').adminEvents);
router.post('/shipping/sync', require('../controllers/webhookController').ithinkSync);

module.exports = router;
