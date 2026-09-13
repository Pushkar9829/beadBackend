const { asyncHandler } = require('../utils/asyncHandler');
const cashfree = require('../services/cashfreeService');

exports.cashfreeWebhook = asyncHandler(async (req, res) => {
  const raw = req.rawBody != null ? req.rawBody : (Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body || {}));
  const signature = req.headers['x-webhook-signature'];
  const timestamp = req.headers['x-webhook-timestamp'];
  const skip = process.env.CASHFREE_SKIP_WEBHOOK_VERIFY === 'true' && process.env.NODE_ENV !== 'production';
  const ok = skip || (await cashfree.verifyWebhookSignature(signature, timestamp, raw));
  if (!ok) return res.status(401).json({ message: 'Invalid Cashfree webhook signature.' });

  let event = req.body;
  if (Buffer.isBuffer(event) || typeof event === 'string') {
    try {
      event = JSON.parse(raw);
    } catch {
      return res.status(400).json({ message: 'Invalid webhook body.' });
    }
  }

  const type = String(event?.type || event?.event || '');
  const cfOrderId = event?.data?.order?.order_id || event?.data?.order?.orderId;
  const payment = event?.data?.payment || {};
  const order = await cashfree.findByCashfreeOrderId(cfOrderId);
  if (!order) return res.status(200).json({ ok: true, ignored: true });

  if (type.includes('SUCCESS') || cashfree.paidStatus(event?.data?.order?.order_status) || cashfree.paidStatus(payment.payment_status)) {
    await cashfree.fulfillPaidOrder(order, {
      gatewayRef: payment.cf_payment_id || payment.payment_id,
      note: `Cashfree webhook ${type || 'PAYMENT_SUCCESS'}`,
    });
  } else if (type.includes('FAILED') || type.includes('DROPPED') || cashfree.failedStatus(payment.payment_status)) {
    await cashfree.markFailed(order, `Cashfree webhook ${type || payment.payment_status}`);
  }

  res.json({ ok: true });
});
