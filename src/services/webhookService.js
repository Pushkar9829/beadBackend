const crypto = require('crypto');
const Order = require('../models/Order');
const ReturnRequest = require('../models/ReturnRequest');
const WebhookEvent = require('../models/WebhookEvent');
const cashfree = require('./cashfreeService');
const ithink = require('./ithinkService');
const { webhookUrls } = require('../lib/publicUrl');

const EVENT_STALE_MS = 10 * 60 * 1000;
const ITHINK_SYNC_MAX_AWBS = 50;

function sha256(value) {
  return crypto.createHash('sha256').update(String(value == null ? '' : value)).digest('hex');
}

async function recordEvent({ provider, eventId, eventType, status, ref, message }) {
  try {
    await WebhookEvent.create({
      provider,
      eventId: eventId || `${provider}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
      eventType,
      status,
      ref,
      message: String(message || '').slice(0, 500),
    });
  } catch (err) {
    if (err.code !== 11000) throw err;
  }
}

/**
 * Atomically claims an event for processing. The unique (provider, eventId) index makes the insert the lock:
 * a duplicate delivery gets false. Events left 'failed' (or stuck 'processing' for too long) can be re-claimed.
 */
async function claimEvent({ provider, eventId, eventType, ref }) {
  try {
    await WebhookEvent.create({ provider, eventId, eventType, status: 'processing', ref: ref || '' });
    return true;
  } catch (err) {
    if (err.code !== 11000) throw err;
  }
  const staleBefore = new Date(Date.now() - EVENT_STALE_MS);
  const retaken = await WebhookEvent.findOneAndUpdate(
    {
      provider,
      eventId,
      $or: [{ status: 'failed' }, { status: 'processing', updatedAt: { $lt: staleBefore } }],
    },
    { $set: { status: 'processing', message: '' } },
    { returnDocument: 'after' }
  );
  return Boolean(retaken);
}

async function finishEvent({ provider, eventId }, { status, ref, message, eventType }) {
  await WebhookEvent.updateOne(
    { provider, eventId },
    {
      $set: {
        status,
        ...(ref != null ? { ref: String(ref) } : {}),
        ...(eventType != null ? { eventType } : {}),
        message: String(message || '').slice(0, 500),
      },
    }
  );
}

// Runs handler exactly once per (provider, eventId). Throws (so the caller returns 5xx) if the handler fails,
// after marking the event 'failed' so the provider's retry can reprocess it.
async function processOnce(meta, handler) {
  const claimed = await claimEvent(meta);
  if (!claimed) return { ok: true, ignored: true, reason: 'duplicate' };
  let outcome;
  try {
    outcome = await handler();
  } catch (err) {
    try {
      await finishEvent(meta, { status: 'failed', message: err.message || 'Processing failed' });
    } catch {
      await WebhookEvent.deleteOne({ provider: meta.provider, eventId: meta.eventId }).catch(() => {});
    }
    throw err;
  }
  await finishEvent(meta, outcome);
  return outcome.result;
}

function cashfreeEventId(type, event, rawBody) {
  const payment = event?.data?.payment || {};
  const refund = event?.data?.refund || {};
  if (type.includes('REFUND') && (refund.cf_refund_id || refund.refund_id)) {
    return `${type}:${refund.cf_refund_id || refund.refund_id}:${String(refund.refund_status || '').toUpperCase()}`;
  }
  if (payment.cf_payment_id) {
    return `${type}:${payment.cf_payment_id}:${String(payment.payment_status || '').toUpperCase()}`;
  }
  return `sha256:${sha256(rawBody != null ? rawBody : JSON.stringify(event || {}))}`;
}

function isFullRefund(order, amount) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return false;
  return value >= Number(order.total || 0) - 0.01;
}

async function applyCashfreeRefund(order, { type, refund }) {
  const refundStatus = String(refund.refund_status || refund.status || '').toUpperCase();
  if (!['SUCCESS', 'COMPLETED', 'REFUNDED'].includes(refundStatus)) {
    return { status: 'ignored', ref: order.orderNumber, message: `refund ${refundStatus || type}` };
  }
  const refundId = String(refund.refund_id || refund.cf_refund_id || '');
  const amount = refund.refund_amount;
  const now = new Date();
  // refundedAmount is reserved by createRefund for refunds started from admin; a full refund confirmed here
  // (including one issued from the Cashfree dashboard) closes the order either way.
  if (isFullRefund(order, amount) || Number(order.payment?.refundedAmount || 0) >= Number(order.total || 0) - 0.01) {
    await Order.updateOne(
      { _id: order._id, 'payment.status': { $ne: 'refunded' } },
      {
        $set: { 'payment.status': 'refunded', ...(refundId ? { 'payment.refundId': refundId } : {}) },
        $push: { timeline: { status: order.status, note: `Cashfree refund ${refundStatus}: ₹${amount} (full)`, at: now } },
      }
    );
    return { status: 'applied', ref: order.orderNumber, message: `full refund ${amount}` };
  }
  // Partial refund: keep payment.status, just record it.
  await Order.updateOne(
    { _id: order._id },
    {
      ...(refundId ? { $set: { 'payment.refundId': refundId } } : {}),
      $push: {
        timeline: {
          status: order.status,
          note: `Cashfree partial refund ${refundStatus}: ₹${amount ?? '?'} of ₹${order.total}${refundId ? ` (${refundId})` : ''}`,
          at: now,
        },
      },
    }
  );
  return { status: 'applied', ref: order.orderNumber, message: `partial refund ${amount}` };
}

async function applyCashfreePaid(order, { type, orderData, payment }) {
  const amount = orderData.order_amount != null ? orderData.order_amount : payment.payment_amount;
  const currency = orderData.order_currency || payment.payment_currency || 'INR';
  if (!cashfree.amountMatches(order, amount, currency)) {
    await cashfree.reportAmountMismatch(order, { amount, currency, source: `webhook ${type}` });
    return { status: 'mismatch', ref: order.orderNumber, message: `amount ${amount} ${currency} != ${order.total}` };
  }
  const fresh = await cashfree.fulfillPaidOrder(order, {
    gatewayRef: payment.cf_payment_id || payment.payment_id,
    note: `Cashfree webhook ${type || 'PAYMENT_SUCCESS'}`,
  });
  const closed = ['cancelled', 'returned'].includes(fresh?.status);
  if (fresh?.payment?.status === 'paid' && !closed && !fresh.payment.fulfilledAt) {
    // Another run claimed the payment and hasn't finished; make the provider retry later.
    const err = new Error('Payment fulfillment still in progress.');
    err.status = 503;
    throw err;
  }
  if (fresh?.payment?.status === 'refunded') {
    return { status: 'ignored', ref: order.orderNumber, message: 'Order already refunded; payment not re-applied' };
  }
  return { status: 'applied', ref: order.orderNumber, message: closed ? `paid on ${fresh.status} order (refund required)` : 'paid' };
}

async function applyCashfreeEvent(event, { rawBody } = {}) {
  const type = String(event?.type || event?.event || '').toUpperCase();
  const orderData = event?.data?.order || {};
  const payment = event?.data?.payment || {};
  const refund = event?.data?.refund || {};
  const cfOrderId = orderData.order_id || orderData.orderId || refund.order_id;
  const eventId = cashfreeEventId(type, event, rawBody);
  const meta = { provider: 'cashfree', eventId, eventType: type, ref: cfOrderId || '' };

  return processOnce(meta, async () => {
    if (!cfOrderId && !orderData.cf_order_id) {
      return { status: 'ignored', ref: '', message: 'No order id', result: { ok: true, ignored: true } };
    }
    let order = await cashfree.findByCashfreeOrderId(cfOrderId);
    if (!order && orderData.cf_order_id) {
      order = await Order.findOne({ 'payment.cfNumericId': String(orderData.cf_order_id) });
    }
    if (!order) {
      return { status: 'ignored', ref: cfOrderId, message: 'Order not found', result: { ok: true, ignored: true } };
    }

    if (type.includes('REFUND')) {
      const outcome = await applyCashfreeRefund(order, { type, refund });
      return { ...outcome, result: { ok: true, orderId: order._id } };
    }

    if (type.includes('SUCCESS') || cashfree.paidStatus(orderData.order_status) || cashfree.paidStatus(payment.payment_status)) {
      const outcome = await applyCashfreePaid(order, { type, orderData, payment });
      return {
        ...outcome,
        result: outcome.status === 'mismatch'
          ? { ok: true, ignored: true, reason: 'amount_mismatch', orderId: order._id }
          : { ok: true, orderId: order._id },
      };
    }

    if (type.includes('FAILED') || type.includes('DROPPED') || cashfree.failedStatus(payment.payment_status) || cashfree.failedStatus(orderData.order_status)) {
      await cashfree.markFailed(order, `Cashfree webhook ${type || payment.payment_status}`);
      return { status: 'applied', ref: order.orderNumber, message: type || 'failed', result: { ok: true, orderId: order._id } };
    }

    return { status: 'ignored', ref: order.orderNumber, message: 'Unhandled event', result: { ok: true, ignored: true } };
  });
}

function pick(obj, keys) {
  for (const key of keys) {
    if (obj?.[key] != null && obj[key] !== '') return obj[key];
  }
  return '';
}

function parseIthinkItem(item = {}) {
  const src = item.data || item.shipment || item;
  return {
    waybill: String(pick(src, ['awb_number', 'awb_no', 'waybill', 'awb', 'airway_bill_no', 'tracking_number'])).trim(),
    orderNumber: String(pick(src, ['order_number', 'order', 'refnum', 'order_id', 'orderNumber'])).trim(),
    currentStatus: String(pick(src, ['current_status', 'status', 'shipment_status'])).trim(),
    currentStatusCode: String(pick(src, ['current_status_code', 'status_code'])).trim(),
    carrier: String(pick(src, ['logistic', 'logistic_name', 'carrier'])).trim(),
    orderType: String(pick(src, ['order_type', 'type'])).trim(),
    expectedDelivery: String(pick(src, ['expected_delivery_date', 'edd', 'promise_delivery_date'])).trim(),
    remark: String(pick(src, ['remark', 'reason', 'message'])).trim(),
    location: String(pick(src, ['scan_location', 'location'])).trim(),
  };
}

function parseIthinkEvents(body = {}) {
  const root = body.data && typeof body.data === 'object' && !Array.isArray(body.data) && !body.awb_number && !body.awb_no && !body.waybill
    ? body.data
    : body;
  if (root && typeof root === 'object' && !Array.isArray(root) && !root.awb_number && !root.awb_no && !root.waybill && !root.shipments) {
    const keyed = Object.entries(root).filter(([, value]) => (
      value && typeof value === 'object' && (value.current_status || value.awb_no || value.awb_number || value.status || value.logistic)
    ));
    if (keyed.length) {
      return keyed
        .map(([key, value]) => parseIthinkItem({ ...value, awb_number: value.awb_no || value.awb_number || key }))
        .filter((row) => row.waybill || row.orderNumber);
    }
  }
  const list = Array.isArray(root)
    ? root
    : Array.isArray(root.shipments)
      ? root.shipments
      : Array.isArray(root.awb_number_list)
        ? root.awb_number_list.map((awb) => ({ awb_number: awb }))
        : [root];
  return list.map(parseIthinkItem).filter((row) => row.waybill || row.orderNumber);
}

function headerValue(req, name) {
  const value = req.headers?.[name] || req.headers?.[String(name).toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

// Token is accepted from headers only (never query string or body, which end up in logs/caches).
function webhookTokenFrom(req) {
  return String(headerValue(req, 'x-ithink-token') || headerValue(req, 'x-webhook-secret') || '').trim();
}

let warnedNoIthinkSecret = false;

async function verifyIthinkRequest(req) {
  const expected = await ithink.webhookSecret();
  if (!expected) {
    if (!warnedNoIthinkSecret) {
      console.warn('[ithink] Webhook rejected: no iThink webhook secret configured (set ITHINK_WEBHOOK_SECRET or Settings > Shipping).');
      warnedNoIthinkSecret = true;
    }
    return false;
  }
  warnedNoIthinkSecret = false;
  const got = webhookTokenFrom(req);
  if (!got) return false;
  return safeEqual(got, expected);
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

async function findOrderForShipment(update) {
  const clauses = [];
  if (update.waybill) {
    clauses.push({ 'shipment.waybill': update.waybill });
    clauses.push({ 'shipment.returnWaybill': update.waybill });
  }
  if (update.orderNumber) {
    const base = String(update.orderNumber).replace(/-(R|X|F\d+)$/i, '');
    clauses.push({ orderNumber: update.orderNumber });
    if (base && base !== update.orderNumber) clauses.push({ orderNumber: base });
  }
  if (!clauses.length) return null;
  return Order.findOne({ $or: clauses });
}

async function applyIthinkUpdate(update) {
  const eventId = [update.waybill || update.orderNumber, update.currentStatus, update.currentStatusCode].filter(Boolean).join(':')
    || `sha256:${sha256(JSON.stringify(update))}`;
  const meta = { provider: 'ithink', eventId, eventType: update.currentStatus, ref: update.waybill || update.orderNumber };
  return processOnce(meta, async () => {
    const order = await findOrderForShipment(update);
    if (!order) {
      return {
        status: 'ignored',
        ref: update.waybill || update.orderNumber,
        message: 'Shipment not found',
        result: { ok: true, ignored: true },
      };
    }
    const target = order.shipment?.returnWaybill && update.waybill === order.shipment.returnWaybill ? 'return' : 'forward';
    await ithink.applyTrackingToOrder(order, {
      waybill: update.waybill,
      currentStatus: update.currentStatus,
      currentStatusCode: update.currentStatusCode,
      carrier: update.carrier,
      orderType: update.orderType,
      expectedDelivery: update.expectedDelivery,
      trackingUrl: update.waybill ? `https://my.ithinklogistics.com/tracking/${update.waybill}` : '',
    }, target);
    if (update.remark) {
      order.timeline = order.timeline || [];
      order.timeline.push({
        status: order.status,
        note: `iThink webhook: ${update.currentStatus || 'update'}${update.location ? ` @ ${update.location}` : ''}${update.remark ? ` — ${update.remark}` : ''}`.slice(0, 300),
        at: new Date(),
      });
    }
    await order.save();
    if (update.waybill) {
      await ReturnRequest.updateMany(
        { 'shipment.waybill': update.waybill },
        { $set: { 'shipment.lastStatus': update.currentStatus || '' } }
      );
    }
    return {
      status: 'applied',
      ref: order.orderNumber,
      message: update.waybill,
      result: { ok: true, orderId: order._id, orderNumber: order.orderNumber },
    };
  });
}

async function applyIthinkEvents(body) {
  const updates = parseIthinkEvents(body);
  if (!updates.length) return { ok: true, ignored: true, reason: 'empty' };
  const results = [];
  for (const update of updates) {
    results.push(await applyIthinkUpdate(update));
  }
  return { ok: true, count: results.length, results };
}

async function syncRecentIthink(minutes = 25) {
  const to = new Date();
  const from = new Date(to.getTime() - Math.min(30, Math.max(5, Number(minutes) || 25)) * 60 * 1000);
  const changed = await ithink.listChangedAwbs(from, to);
  const awbs = [...new Set(changed)].slice(0, ITHINK_SYNC_MAX_AWBS);
  const results = [];
  for (const awb of awbs) {
    try {
      const order = await Order.findOne({ $or: [{ 'shipment.waybill': awb }, { 'shipment.returnWaybill': awb }] });
      if (!order) {
        results.push({ awb, ignored: true });
        continue;
      }
      const tracking = await ithink.track(awb);
      const target = order.shipment?.returnWaybill === awb ? 'return' : 'forward';
      await ithink.applyTrackingToOrder(order, tracking, target);
      await order.save();
      results.push({ awb, orderNumber: order.orderNumber, status: tracking.currentStatus });
    } catch (err) {
      results.push({ awb, error: err.message || 'sync failed' });
    }
  }
  return {
    from,
    to,
    awbs: awbs.length,
    totalChanged: changed.length,
    truncated: changed.length > awbs.length,
    results,
  };
}

async function recentEvents(limit = 40) {
  return WebhookEvent.find().sort({ createdAt: -1 }).limit(limit).lean();
}

module.exports = {
  webhookUrls,
  applyCashfreeEvent,
  applyIthinkEvents,
  verifyIthinkRequest,
  syncRecentIthink,
  recentEvents,
  recordEvent,
  safeEqual,
};
