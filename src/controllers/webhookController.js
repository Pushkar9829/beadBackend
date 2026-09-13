const { asyncHandler } = require('../utils/asyncHandler');
const cashfree = require('../services/cashfreeService');
const webhooks = require('../services/webhookService');

function header(req, name) {
  const value = req.headers[name] || req.headers[String(name).toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function parseBody(req) {
  const raw = req.rawBody != null
    ? req.rawBody
    : Buffer.isBuffer(req.body)
      ? req.body.toString('utf8')
      : typeof req.body === 'string'
        ? req.body
        : '';
  let event = req.body;
  if (Buffer.isBuffer(event) || typeof event === 'string' || !event || Object.keys(event).length === 0) {
    if (!raw) return {};
    try {
      event = JSON.parse(raw);
    } catch {
      event = req.body && typeof req.body === 'object' ? req.body : {};
    }
  }
  return event || {};
}

exports.list = asyncHandler(async (req, res) => {
  res.json({
    ok: true,
    webhooks: webhooks.webhookUrls(req),
    events: [
      'Cashfree: PAYMENT_SUCCESS_WEBHOOK, PAYMENT_FAILED_WEBHOOK, PAYMENT_USER_DROPPED_WEBHOOK, REFUND_STATUS_WEBHOOK',
      'iThink: shipment status push (AWB / order number / current_status)',
    ],
  });
});

exports.cashfreeInfo = asyncHandler(async (req, res) => {
  res.json({
    ok: true,
    provider: 'cashfree',
    url: webhooks.webhookUrls(req).cashfree,
    verify: 'x-webhook-signature + x-webhook-timestamp HMAC-SHA256',
  });
});

exports.cashfreeWebhook = asyncHandler(async (req, res) => {
  const raw = req.rawBody != null ? req.rawBody : (Buffer.isBuffer(req.body) ? req.body.toString('utf8') : null);
  if (raw == null) return res.status(400).json({ message: 'Missing webhook body.' });
  const signature = header(req, 'x-webhook-signature');
  const timestamp = header(req, 'x-webhook-timestamp');
  const skip = process.env.CASHFREE_SKIP_WEBHOOK_VERIFY === 'true' && process.env.NODE_ENV !== 'production';
  const ok = skip || (await cashfree.verifyWebhookSignature(signature, timestamp, raw));
  if (!ok) return res.status(401).json({ message: 'Invalid Cashfree webhook signature.' });

  let event;
  try {
    event = parseBody(req);
  } catch {
    return res.status(400).json({ message: 'Invalid webhook body.' });
  }

  try {
    const result = await webhooks.applyCashfreeEvent(event, {
      'x-idempotency-id': header(req, 'x-idempotency-id'),
    });
    res.json(result);
  } catch (err) {
    try {
      await webhooks.recordEvent({
        provider: 'cashfree',
        eventType: event?.type || 'cashfree',
        status: 'failed',
        ref: event?.data?.order?.order_id || '',
        message: err.message,
      });
    } catch {
      /* keep webhook ack */
    }
    res.status(200).json({ ok: false, retry: true, message: err.message || 'Webhook processing failed.' });
  }
});

exports.ithinkInfo = asyncHandler(async (req, res) => {
  res.json({
    ok: true,
    provider: 'ithink',
    url: webhooks.webhookUrls(req).ithink,
    verify: 'x-ithink-token, x-webhook-secret, or ?token=',
  });
});

exports.ithinkWebhook = asyncHandler(async (req, res) => {
  const body = parseBody(req);
  const allowed = await webhooks.verifyIthinkRequest(req, body);
  if (!allowed) return res.status(401).json({ message: 'Invalid iThink webhook token.' });
  try {
    const result = await webhooks.applyIthinkEvents(body);
    res.json(result);
  } catch (err) {
    try {
      await webhooks.recordEvent({
        provider: 'ithink',
        eventType: 'webhook',
        status: 'failed',
        ref: '',
        message: err.message,
      });
    } catch {
      /* keep webhook ack */
    }
    res.status(200).json({ ok: false, retry: true, message: err.message || 'Webhook processing failed.' });
  }
});

exports.ithinkSync = asyncHandler(async (req, res) => {
  const { STAFF_ROLES } = require('../middleware/auth');
  const staff = req.user && STAFF_ROLES.includes(req.user.role);
  const cron = String(header(req, 'x-sync-secret') || req.query.token || req.body?.token || '').trim();
  const envSecret = String(process.env.ITHINK_SYNC_SECRET || process.env.ITHINK_WEBHOOK_SECRET || '').trim();
  const stored = await require('../services/ithinkService').webhookSecret();
  const expected = envSecret || stored;
  const tokenOk = Boolean(expected && cron && webhooks.safeEqual(cron, expected));
  if (!staff && !tokenOk) {
    return res.status(401).json({ message: 'Invalid sync token.' });
  }
  const result = await webhooks.syncRecentIthink(req.body?.minutes || req.query.minutes);
  res.json(result);
});

exports.adminEvents = asyncHandler(async (_req, res) => {
  const events = await webhooks.recentEvents(50);
  res.json({ events, webhooks: webhooks.webhookUrls() });
});
