const express = require('express');
const ctrl = require('../controllers/webhookController');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/ithink/webhook', ctrl.ithinkInfo);
router.post('/ithink/webhook', ctrl.ithinkWebhook);
router.post('/ithink/sync', ctrl.ithinkSync);
router.post('/ithink/sync/admin', requireAuth, requireAdmin, ctrl.ithinkSync);

module.exports = router;
