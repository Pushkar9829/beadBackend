const express = require('express');
const platform = require('../controllers/platformController');
const wishlist = require('../controllers/wishlistController');
const { requireAuth } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');

const router = express.Router();

router.get('/store', platform.publicStore);
router.get('/coupons', platform.publicCoupons);
router.get('/collections', platform.publicCollections);
router.get('/collections/:slug', platform.publicCollection);
router.get('/banners', platform.publicBanners);
router.get('/flash-sales/active', platform.publicFlash);
router.get('/faqs', platform.publicFaqs);
router.get('/blog', platform.publicBlog);
router.get('/blog/:slug', platform.publicBlogOne);
router.get('/home/collections', platform.homeCollections);
const formLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, message: 'Too many submissions. Please try again later.' });
// Nominatim allows ~1 req/s for the whole server, so keep each client well under that.
const geoLimit = rateLimit({ windowMs: 60 * 1000, max: 10 });
const pincodeLimit = rateLimit({ windowMs: 60 * 1000, max: 30 });

router.get('/pincode/:pincode', pincodeLimit, platform.checkPin);
router.get('/geo/reverse', geoLimit, platform.reverseGeo);
router.post('/newsletter', formLimit, platform.subscribe);
router.post('/contact', formLimit, platform.contact);

router.get('/wishlist', requireAuth, wishlist.get);
router.post('/wishlist', requireAuth, wishlist.add);
router.post('/wishlist/merge', requireAuth, wishlist.merge);
router.delete('/wishlist/:productId', requireAuth, wishlist.remove);

router.get('/checkout/quote', requireAuth, platform.checkoutQuote);

module.exports = router;
