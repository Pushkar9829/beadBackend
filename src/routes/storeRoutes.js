const express = require('express');
const platform = require('../controllers/platformController');
const wishlist = require('../controllers/wishlistController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/collections', platform.publicCollections);
router.get('/collections/:slug', platform.publicCollection);
router.get('/banners', platform.publicBanners);
router.get('/flash-sales/active', platform.publicFlash);
router.get('/faqs', platform.publicFaqs);
router.get('/blog', platform.publicBlog);
router.get('/blog/:slug', platform.publicBlogOne);
router.get('/home/collections', platform.homeCollections);
router.get('/pincode/:pincode', platform.checkPin);
router.post('/newsletter', platform.subscribe);
router.post('/contact', platform.contact);

router.get('/wishlist', requireAuth, wishlist.get);
router.post('/wishlist', requireAuth, wishlist.add);
router.post('/wishlist/merge', requireAuth, wishlist.merge);
router.delete('/wishlist/:productId', requireAuth, wishlist.remove);

router.get('/checkout/quote', requireAuth, platform.checkoutQuote);

module.exports = router;
