const express = require('express');
const ctrl = require('../controllers/webhookController');

const router = express.Router();

router.get('/cashfree/webhook', ctrl.cashfreeInfo);
router.post('/cashfree/webhook', ctrl.cashfreeWebhook);

module.exports = router;
