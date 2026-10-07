const { asyncHandler } = require('../utils/asyncHandler');
const cashfree = require('../services/cashfreeService');
const webhooks = require('../services/webhookService');
const ithink = require('../services/ithinkService');

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

function retryResponse(res, provider, err) {
  // Logged without headers/body so tokens and customer data never reach the logs.
  console.error(`[webhook:${provider}] processing failed: ${err?.message || err}`);
  // Non-2xx so the provider retries; the event was marked failed and can be re-claimed.
  return res.status(500).json({ ok: false, retry: true, message: 'Webhook processing failed.' });
}

exports.list = asyncHandler(async (req, res) => {
  const urls = webhooks.webhookUrls(req);
  res.json({
    ok: true,
    webhooks: { cashfree: urls.cashfree, ithink: urls.ithink },
  });
});

exports.cashfreeInfo = asyncHandler(async (req, res) => {
  res.json({
    ok: true,
    provider: 'cashfree',
    url: webhooks.webhookUrls(req).cashfree,
    verify: 'x-webhook-signature + x-webhook-timestamp HMAC-SHA256 (timestamp must be within 5 minutes)',
  });
});

exports.cashfreeWebhook = asyncHandler(async (req, res) => {
  const raw = req.rawBody != null ? req.rawBody : (Buffer.isBuffer(req.body) ? req.body.toString('utf8') : null);
  if (raw == null) return res.status(400).json({ message: 'Missing webhook body.' });
  const signature = header(req, 'x-webhook-signature');
  const timestamp = header(req, 'x-webhook-timestamp');
  const ok = await cashfree.verifyWebhookSignature(signature, timestamp, raw);
  if (!ok) return res.status(401).json({ message: 'Invalid Cashfree webhook signature.' });

  let event;
  try {
    event = parseBody(req);
  } catch {
    return res.status(400).json({ message: 'Invalid webhook body.' });
  }

  try {
    const result = await webhooks.applyCashfreeEvent(event, { rawBody: raw });
    res.json(result);
  } catch (err) {
    retryResponse(res, 'cashfree', err);
  }
});

exports.ithinkInfo = asyncHandler(async (req, res) => {
  res.json({
    ok: true,
    provider: 'ithink',
    url: webhooks.webhookUrls(req).ithink,
    verify: 'Send the configured webhook secret in the x-ithink-token or x-webhook-secret header. Requests are rejected if no secret is configured.',
  });
});

exports.ithinkWebhook = asyncHandler(async (req, res) => {
  const allowed = await webhooks.verifyIthinkRequest(req);
  if (!allowed) return res.status(401).json({ message: 'Invalid iThink webhook token.' });
  const body = parseBody(req);
  try {
    const result = await webhooks.applyIthinkEvents(body);
    res.json(result);
  } catch (err) {
    retryResponse(res, 'ithink', err);
  }
});

exports.ithinkSync = asyncHandler(async (req, res) => {
  const { STAFF_ROLES } = require('../middleware/auth');
  const staff = req.user && STAFF_ROLES.includes(req.user.role);
  // Cron token is accepted from the header only (never ?token= or body).
  const cron = String(header(req, 'x-sync-secret') || '').trim();
  const envSecret = String(process.env.ITHINK_SYNC_SECRET || process.env.ITHINK_WEBHOOK_SECRET || '').trim();
  const expected = envSecret || (await ithink.webhookSecret());
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
