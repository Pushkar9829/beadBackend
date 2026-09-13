const crypto = require('crypto');
const Order = require('../models/Order');
const ReturnRequest = require('../models/ReturnRequest');
const WebhookEvent = require('../models/WebhookEvent');
const cashfree = require('./cashfreeService');
const ithink = require('./ithinkService');
const { webhookUrls } = require('../lib/publicUrl');

async function alreadyProcessed(provider, eventId) {
  if (!eventId) return false;
  const existing = await WebhookEvent.findOne({ provider, eventId }).lean();
  return Boolean(existing);
}

async function recordEvent({ provider, eventId, eventType, status, ref, message }) {
  try {
    await WebhookEvent.create({
      provider,
      eventId: eventId || `${provider}-${Date.now()}`,
      eventType,
      status,
      ref,
      message: String(message || '').slice(0, 500),
    });
  } catch (err) {
    if (err.code !== 11000) throw err;
  }
}

async function applyCashfreeEvent(event, headers = {}) {
  const type = String(event?.type || event?.event || '').toUpperCase();
  const orderData = event?.data?.order || {};
  const payment = event?.data?.payment || {};
  const refund = event?.data?.refund || {};
  const cfOrderId = orderData.order_id || orderData.orderId || refund.order_id;
  const eventId = headers['x-idempotency-id'] || [type, cfOrderId, payment.cf_payment_id || refund.refund_id || ''].filter(Boolean).join(':');
  if (!cfOrderId && !orderData.cf_order_id) {
    await recordEvent({ provider: 'cashfree', eventId: eventId || `cashfree-${Date.now()}`, eventType: type, status: 'ignored', ref: '', message: 'No order id' });
    return { ok: true, ignored: true };
  }

  if (await alreadyProcessed('cashfree', eventId)) {
    return { ok: true, ignored: true, reason: 'duplicate' };
  }

  let order = await cashfree.findByCashfreeOrderId(cfOrderId);
  if (!order && orderData.cf_order_id) {
    order = await Order.findOne({ 'payment.cfNumericId': String(orderData.cf_order_id) });
  }
  if (!order) {
    await recordEvent({ provider: 'cashfree', eventId, eventType: type, status: 'ignored', ref: cfOrderId, message: 'Order not found' });
    return { ok: true, ignored: true };
  }

  if (type.includes('REFUND')) {
    const refundStatus = String(refund.refund_status || refund.status || '').toUpperCase();
    if (['SUCCESS', 'COMPLETED', 'REFUNDED'].includes(refundStatus) || type.includes('SUCCESS')) {
      order.payment = order.payment || {};
      order.payment.status = 'refunded';
      order.payment.refundId = refund.refund_id || order.payment.refundId;
      order.timeline = order.timeline || [];
      order.timeline.push({ status: order.status, note: `Cashfree refund ${refundStatus || type}`, at: new Date() });
      await order.save();
    }
    await recordEvent({ provider: 'cashfree', eventId, eventType: type, status: 'applied', ref: order.orderNumber, message: refundStatus || type });
    return { ok: true, orderId: order._id };
  }

  if (type.includes('SUCCESS') || cashfree.paidStatus(orderData.order_status) || cashfree.paidStatus(payment.payment_status)) {
    await cashfree.fulfillPaidOrder(order, {
      gatewayRef: payment.cf_payment_id || payment.payment_id,
      note: `Cashfree webhook ${type || 'PAYMENT_SUCCESS'}`,
    });
    await recordEvent({ provider: 'cashfree', eventId, eventType: type, status: 'applied', ref: order.orderNumber, message: 'paid' });
    return { ok: true, orderId: order._id };
  }

  if (type.includes('FAILED') || type.includes('DROPPED') || cashfree.failedStatus(payment.payment_status) || cashfree.failedStatus(orderData.order_status)) {
    await cashfree.markFailed(order, `Cashfree webhook ${type || payment.payment_status}`);
    await recordEvent({ provider: 'cashfree', eventId, eventType: type, status: 'applied', ref: order.orderNumber, message: type || 'failed' });
    return { ok: true, orderId: order._id };
  }

  await recordEvent({ provider: 'cashfree', eventId, eventType: type, status: 'ignored', ref: order.orderNumber, message: 'Unhandled event' });
  return { ok: true, ignored: true };
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

function webhookTokenFrom(req, body = {}) {
  return String(
    headerValue(req, 'x-ithink-token')
    || headerValue(req, 'x-webhook-secret')
    || headerValue(req, 'x-webhook-signature')
    || req.query?.token
    || body.secret_key
    || body.token
    || body.access_token
    || body.data?.secret_key
    || body.data?.access_token
    || body.data?.token
    || ''
  ).trim();
}

async function verifyIthinkRequest(req, body) {
  const expected = await ithink.webhookSecret();
  const got = webhookTokenFrom(req, body);
  if (!expected) return true;
  if (!got) return false;
  if (safeEqual(got, expected)) return true;
  const cfg = await ithink.getConfig();
  if (cfg.accessToken && safeEqual(got, cfg.accessToken)) return true;
  return false;
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
  const eventId = [update.waybill || update.orderNumber, update.currentStatus, update.currentStatusCode].filter(Boolean).join(':');
  if (await alreadyProcessed('ithink', eventId)) {
    return { ok: true, ignored: true, reason: 'duplicate' };
  }
  const order = await findOrderForShipment(update);
  if (!order) {
    await recordEvent({ provider: 'ithink', eventId, eventType: update.currentStatus, status: 'ignored', ref: update.waybill || update.orderNumber, message: 'Shipment not found' });
    return { ok: true, ignored: true };
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
      note: `iThink webhook: ${update.currentStatus || 'update'}${update.location ? ` @ ${update.location}` : ''}${update.remark ? ` — ${update.remark}` : ''}`,
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
  await recordEvent({ provider: 'ithink', eventId, eventType: update.currentStatus, status: 'applied', ref: order.orderNumber, message: update.waybill });
  return { ok: true, orderId: order._id, orderNumber: order.orderNumber };
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
  const awbs = await ithink.listChangedAwbs(from, to);
  const results = [];
  for (const awb of awbs) {
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
  }
  return { from, to, awbs: awbs.length, results };
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
