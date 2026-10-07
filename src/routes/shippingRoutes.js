const express = require('express');
const ctrl = require('../controllers/webhookController');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');

const router = express.Router();

router.get('/ithink/webhook', ctrl.ithinkInfo);
router.post('/ithink/webhook', ctrl.ithinkWebhook);
// Token-protected (header) endpoint for an external cron; throttled since it fans out to iThink.
router.post('/ithink/sync', rateLimit({ windowMs: 60 * 1000, max: 2 }), ctrl.ithinkSync);
router.post('/ithink/sync/admin', requireAuth, requireAdmin, ctrl.ithinkSync);

module.exports = router;
