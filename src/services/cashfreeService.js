const crypto = require('crypto');
const StoreSettings = require('../models/StoreSettings');
const { publicApiOrigin } = require('../lib/publicUrl');
const Order = require('../models/Order');
const Cart = require('../models/Cart');
const { findUsableCoupon, recordUsage } = require('./couponService');
const { recordFlashSaleOrder } = require('./flashSaleService');
const { deductOrderStock } = require('./inventoryService');
const { notify } = require('./notificationService');

const API_VERSION = '2025-01-01';
const AMOUNT_TOLERANCE = 0.01;
const WEBHOOK_MAX_SKEW_MS = 5 * 60 * 1000;
const CLOSED_STATUSES = ['cancelled', 'returned'];
const CLAIMABLE_PAYMENT = ['pending', 'failed'];
const FULFILL_STALE_MS = 2 * 60 * 1000;

function httpTimeoutMs() {
  return Number(process.env.HTTP_TIMEOUT_MS) || 15000;
}

function envName(value) {
  return String(value || 'sandbox').toLowerCase() === 'production' ? 'production' : 'sandbox';
}

function baseUrl(env) {
  return env === 'production' ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg';
}

function indiaPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  if (digits.length === 10) return digits;
  return '';
}

async function loadSettings() {
  return StoreSettings.findOne({ key: 'store' }).lean();
}

async function getCredentials() {
  const stored = await loadSettings();
  const pay = stored?.payment || {};
  const appId = String(pay.cashfreeAppId || process.env.CASHFREE_APP_ID || '').trim();
  const secret = String(pay.cashfreeSecret || process.env.CASHFREE_SECRET_KEY || '').trim();
  const env = envName(pay.cashfreeEnv || process.env.CASHFREE_ENV);
  const enabled = pay.cashfreeEnabled !== false && Boolean(appId && secret);
  return { appId, secret, env, enabled };
}

async function publicConfig() {
  const { appId, env, enabled } = await getCredentials();
  return { enabled, env, appId: enabled ? appId : '' };
}

function headers(creds) {
  return {
    accept: 'application/json',
    'content-type': 'application/json',
    'x-api-version': API_VERSION,
    'x-client-id': creds.appId,
    'x-client-secret': creds.secret,
  };
}

async function cfFetch(path, { method = 'GET', body } = {}) {
  const creds = await getCredentials();
  if (!creds.enabled) {
    const err = new Error('Cashfree is not configured. Add App ID and Secret in Settings or .env.');
    err.status = 400;
    throw err;
  }
  let res;
  try {
    res = await fetch(`${baseUrl(creds.env)}${path}`, {
      method,
      headers: headers(creds),
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(httpTimeoutMs()),
    });
  } catch (cause) {
    const timedOut = cause?.name === 'TimeoutError' || cause?.name === 'AbortError';
    const err = new Error(timedOut ? 'Cashfree did not respond in time.' : 'Could not reach Cashfree.');
    err.status = timedOut ? 504 : 502;
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data.message || data.error || `Cashfree request failed (${res.status}).`;
    const err = new Error(message);
    err.status = res.status >= 400 && res.status < 500 ? 400 : 502;
    err.code = data.code;
    err.details = data;
    throw err;
  }
  return data;
}

function siteOrigin() {
  const listed = String(process.env.CLIENT_ORIGIN || process.env.FRONTEND_URL || '')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
  const publicOne = listed.find((url) => !/localhost|127\.0\.0\.1/i.test(url));
  if (publicOne) return publicOne;
  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
    return 'https://beads-front-end.vercel.app';
  }
  return listed[0] || 'http://localhost:5173';
}

function apiOrigin(req) {
  return publicApiOrigin(req);
}

async function safeNotify(payload) {
  try {
    return await notify(payload);
  } catch (err) {
    // Fall back to a generic type if the Notification enum doesn't know this one yet.
    if (err?.name === 'ValidationError' && payload.type !== 'system') {
      try {
        return await notify({ ...payload, type: 'system', meta: { ...(payload.meta || {}), kind: payload.type } });
      } catch {
        /* notifications must never break payment handling */
      }
    }
    console.warn(`[cashfree] notification failed: ${err?.message || err}`);
    return null;
  }
}

/** True when the gateway amount/currency matches what we charged for this order. */
function amountMatches(order, amount, currency) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return false;
  if (currency && String(currency).toUpperCase() !== 'INR') return false;
  return Math.abs(value - Number(order?.total || 0)) <= AMOUNT_TOLERANCE;
}

async function reportAmountMismatch(order, { amount, currency, source } = {}) {
  const now = new Date();
  const note = `Cashfree amount mismatch (${source || 'gateway'}): got ${amount ?? '?'} ${currency || ''} vs order ₹${order.total}. Not fulfilled.`;
  await Order.updateOne(
    { _id: order._id },
    { $push: { timeline: { status: order.status, note: note.slice(0, 300), at: now } } }
  );
  await safeNotify({
    type: 'payment_failed',
    title: `Payment amount mismatch for ${order.orderNumber}`,
    body: note,
    link: '/admin/orders',
    meta: { orderId: order._id, amount, currency, source, expected: order.total },
  });
}

function remoteMatchesOrder(remote, order, payload) {
  if (!remote) return false;
  if (!amountMatches(order, remote.order_amount, remote.order_currency || 'INR')) return false;
  const tagged = remote.order_tags?.orderNumber;
  if (tagged && tagged !== order.orderNumber) return false;
  if (remote.order_id && payload?.order_id && remote.order_id !== payload.order_id) return false;
  return true;
}

async function createCheckoutSession(order, { req, customer } = {}) {
  const creds = await getCredentials();
  if (!creds.enabled) {
    const err = new Error('Cashfree is not configured.');
    err.status = 400;
    throw err;
  }
  const phone = indiaPhone(customer?.phone || order.phone);
  if (!phone) {
    const err = new Error('Cashfree needs a 10-digit Indian mobile number.');
    err.status = 400;
    throw err;
  }
  const cfOrderId = order.payment?.cfOrderId || order.orderNumber;
  const payload = {
    order_id: cfOrderId,
    order_amount: Number(Number(order.total || 0).toFixed(2)),
    order_currency: 'INR',
    order_note: `Kuberstones ${order.orderNumber}`,
    customer_details: {
      customer_id: String(order.userId || customer?._id || cfOrderId).slice(0, 50),
      customer_name: String(customer?.name || order.contactName || 'Guest').slice(0, 100),
      customer_email: customer?.email || order.email || 'hello@kuberstones.com',
      customer_phone: phone,
    },
    // Cashfree stops accepting payment after this, so a session can't outlive our own expiry job.
    order_expiry_time: new Date(Date.now() + Math.max(16, Number(process.env.PENDING_ORDER_TTL_MINUTES) || 60) * 60 * 1000 - 60 * 1000).toISOString(),
    order_meta: {
      return_url: `${siteOrigin()}/account?placed=${encodeURIComponent(order.orderNumber)}&cf=1`,
      notify_url: `${apiOrigin(req)}/api/payments/cashfree/webhook`,
    },
    order_tags: {
      orderNumber: order.orderNumber,
    },
  };

  let session;
  try {
    session = await cfFetch('/orders', { method: 'POST', body: payload });
  } catch (err) {
    const exists = /already exists|duplicate/i.test(err.message || '') || /order_already_exists/i.test(String(err.code || ''));
    if (!exists) throw err;
    const remote = await cfFetch(`/orders/${encodeURIComponent(cfOrderId)}`);
    const sameOrder = remoteMatchesOrder(remote, order, payload);
    if (paidStatus(remote.order_status)) {
      if (!sameOrder) {
        await reportAmountMismatch(order, {
          amount: remote.order_amount,
          currency: remote.order_currency,
          source: 'checkout (existing paid Cashfree order)',
        });
        const mismatch = new Error('A previous payment for this order does not match the order total. Please contact support.');
        mismatch.status = 409;
        throw mismatch;
      }
      const fresh = await fulfillPaidOrder(order, { gatewayRef: remote.cf_order_id, note: 'Cashfree order already paid' });
      if (fresh && fresh !== order) {
        order.payment = fresh.payment;
        order.status = fresh.status;
        order.timeline = fresh.timeline;
      }
      return {
        paymentSessionId: remote.payment_session_id || order.payment?.sessionId || '',
        orderId: remote.order_id || payload.order_id,
        cfOrderId: remote.cf_order_id || null,
        env: creds.env,
        appId: creds.appId,
        orderStatus: remote.order_status,
        alreadyPaid: true,
      };
    }
    const reusable = sameOrder && (!remote.order_status || ['ACTIVE', 'PENDING'].includes(String(remote.order_status).toUpperCase()));
    if (reusable && remote.payment_session_id) {
      session = remote;
    } else {
      // Remote order is closed, for a different amount, or tagged to another order: start a fresh one.
      payload.order_id = `${order.orderNumber}-${Date.now().toString(36)}`;
      session = await cfFetch('/orders', { method: 'POST', body: payload });
    }
  }

  const set = {
    'payment.method': 'gateway',
    'payment.gateway': 'cashfree',
    'payment.cfOrderId': session.order_id || payload.order_id,
    'payment.sessionId': session.payment_session_id || '',
  };
  if (session.cf_order_id) set['payment.cfNumericId'] = String(session.cf_order_id);
  if (!set['payment.sessionId']) {
    const err = new Error('Cashfree did not return a payment session. Check App ID, secret, and environment.');
    err.status = 502;
    throw err;
  }
  order.payment = order.payment || {};
  order.payment.method = set['payment.method'];
  order.payment.gateway = set['payment.gateway'];
  order.payment.cfOrderId = set['payment.cfOrderId'];
  order.payment.sessionId = set['payment.sessionId'];
  if (set['payment.cfNumericId']) order.payment.cfNumericId = set['payment.cfNumericId'];
  // Targeted update so a concurrent webhook marking the order paid is never overwritten.
  await Order.updateOne({ _id: order._id }, { $set: set });

  return {
    paymentSessionId: session.payment_session_id,
    orderId: session.order_id || payload.order_id,
    cfOrderId: session.cf_order_id || null,
    env: creds.env,
    appId: creds.appId,
    orderStatus: session.order_status || 'ACTIVE',
  };
}

async function fetchOrder(cfOrderId) {
  return cfFetch(`/orders/${encodeURIComponent(cfOrderId)}`);
}

function paidStatus(status) {
  return ['PAID', 'SUCCESS'].includes(String(status || '').toUpperCase());
}

function failedStatus(status) {
  return ['FAILED', 'EXPIRED', 'TERMINATED', 'CANCELLED', 'USER_DROPPED'].includes(String(status || '').toUpperCase());
}

function syncDoc(target, source) {
  if (!target || !source || target === source) return source || target;
  target.payment = source.payment;
  target.status = source.status;
  target.timeline = source.timeline;
  target.inventory = source.inventory;
  if (source.__v != null) target.__v = source.__v;
  return target;
}

// A payment landed on an order that was already cancelled/returned: record it, keep the status, flag a refund.
async function recordPaymentOnClosedOrder(current, { gatewayRef, note, now }) {
  const recorded = await Order.findOneAndUpdate(
    { _id: current._id, status: { $in: CLOSED_STATUSES }, 'payment.status': { $in: CLAIMABLE_PAYMENT } },
    {
      $inc: { __v: 1 },
      $set: {
        'payment.status': 'paid',
        'payment.capturedAt': now,
        ...(gatewayRef ? { 'payment.gatewayRef': String(gatewayRef) } : {}),
      },
      $push: {
        timeline: {
          status: current.status,
          note: `${note || 'Cashfree payment captured'} after order was ${current.status} — refund required`,
          at: now,
        },
      },
    },
    { returnDocument: 'after' }
  );
  if (recorded) {
    await safeNotify({
      type: 'refund_required',
      title: `Refund needed for ${recorded.orderNumber}`,
      body: `Payment of ₹${recorded.total} arrived after the order was ${recorded.status}.`,
      link: '/admin/orders',
      meta: { orderId: recorded._id, total: recorded.total },
    });
  }
  return recorded || Order.findById(current._id);
}

async function runFulfillmentSideEffects(order) {
  await deductOrderStock(order, { strict: false });

  if (order.couponCode) {
    try {
      const coupon = await findUsableCoupon(order.couponCode);
      if (coupon) await recordUsage({ coupon, user: { _id: order.userId }, order, discount: order.discount });
    } catch (err) {
      console.warn(`[cashfree] coupon usage not recorded for ${order.orderNumber}: ${err.message}`);
      await safeNotify({
        type: 'system',
        title: `Coupon limit exceeded on paid order ${order.orderNumber}`,
        body: `Coupon ${order.couponCode} could not be recorded after payment: ${err.message}`,
        link: '/admin/orders',
        meta: { orderId: order._id, couponCode: order.couponCode },
      });
    }
  }

  try {
    await recordFlashSaleOrder(order);
  } catch (err) {
    console.warn(`[cashfree] flash sale stats not recorded for ${order.orderNumber}: ${err.message}`);
  }

  if (order.userId) {
    // Only clear the bag the order was placed from; a bag rebuilt after checkout is kept.
    await Cart.updateOne(
      { userId: order.userId, updatedAt: { $lte: order.createdAt || new Date() } },
      { $set: { items: [], couponCode: '' } }
    );
  }

  await safeNotify({
    type: 'new_order',
    title: `Paid order ${order.orderNumber}`,
    body: `${order.contactName} · ₹${order.total} · Cashfree`,
    link: '/admin/orders',
    meta: { orderId: order._id, total: order.total },
  });
}

/**
 * Marks a Cashfree order paid and runs post-payment side effects.
 * Safe to call repeatedly (verify endpoint + webhook retries): the claim is atomic, and if a previous
 * run claimed the payment but crashed before finishing (no fulfilledAt yet, and older than
 * FULFILL_STALE_MS), the side effects are re-run.
 * Stock deduction and coupon usage are themselves idempotent per order.
 * Callers must verify the amount (amountMatches) before calling this.
 */
async function fulfillPaidOrder(order, { gatewayRef, note } = {}) {
  if (!order?._id) return order;
  const now = new Date();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await Order.findById(order._id);
    if (!current) return order;

    if (CLOSED_STATUSES.includes(current.status)) {
      if (!CLAIMABLE_PAYMENT.includes(current.payment?.status)) return syncDoc(order, current);
      const recorded = await recordPaymentOnClosedOrder(current, { gatewayRef, note, now });
      return syncDoc(order, recorded);
    }

    if (current.payment?.status === 'paid') {
      // Already claimed. If an earlier run crashed/failed before finishing (no fulfilledAt), take over —
      // but only once it is stale, so we don't race a run that is still in progress.
      if (current.payment?.fulfilledAt) return syncDoc(order, current);
      const staleBefore = new Date(now.getTime() - FULFILL_STALE_MS);
      const finisher = await Order.findOneAndUpdate(
        {
          _id: current._id,
          'payment.status': 'paid',
          'payment.fulfilledAt': { $exists: false },
          $or: [{ 'payment.capturedAt': { $lt: staleBefore } }, { 'payment.capturedAt': { $exists: false } }],
        },
        { $set: { 'payment.fulfilledAt': now } },
        { returnDocument: 'after' }
      );
      if (!finisher) return syncDoc(order, await Order.findById(current._id));
      try {
        await runFulfillmentSideEffects(finisher);
      } catch (err) {
        await Order.updateOne({ _id: current._id }, { $unset: { 'payment.fulfilledAt': 1 } });
        throw err;
      }
      return syncDoc(order, await Order.findById(current._id));
    }

    if (!CLAIMABLE_PAYMENT.includes(current.payment?.status)) {
      // e.g. 'refunded' — never re-open a refunded order.
      return syncDoc(order, current);
    }

    const nextStatus = current.status === 'pending_payment' ? 'paid' : current.status;
    const claimed = await Order.findOneAndUpdate(
      {
        _id: current._id,
        status: current.status,
        'payment.status': { $in: CLAIMABLE_PAYMENT },
      },
      {
        $inc: { __v: 1 },
        $set: {
          'payment.status': 'paid',
          'payment.capturedAt': now,
          ...(gatewayRef ? { 'payment.gatewayRef': String(gatewayRef) } : {}),
          status: nextStatus,
        },
        $unset: { 'payment.fulfilledAt': 1 },
        $push: { timeline: { status: nextStatus, note: note || 'Cashfree payment captured', at: now } },
      },
      { returnDocument: 'after' }
    );
    if (!claimed) continue; // lost a race (status/payment changed); re-evaluate

    // fulfilledAt marks side effects done; it stays unset if they throw so a later retry completes them.
    await runFulfillmentSideEffects(claimed);
    await Order.updateOne({ _id: claimed._id, 'payment.status': 'paid' }, { $set: { 'payment.fulfilledAt': new Date() } });
    return syncDoc(order, await Order.findById(claimed._id));
  }
  return syncDoc(order, await Order.findById(order._id));
}

async function markFailed(order, note) {
  const updated = await Order.findOneAndUpdate(
    { _id: order._id, 'payment.status': { $in: ['pending'] } },
    {
      $set: { 'payment.status': 'failed' },
      $push: { timeline: { status: order.status, note: note || 'Cashfree payment failed', at: new Date() } },
    },
    { returnDocument: 'after' }
  );
  if (!updated) {
    const fresh = await Order.findById(order._id);
    return syncDoc(order, fresh) || order;
  }
  await safeNotify({
    type: 'payment_failed',
    title: `Payment failed for ${updated.orderNumber}`,
    body: `${updated.contactName} · ₹${updated.total}`,
    link: '/admin/orders',
  });
  return syncDoc(order, updated);
}

async function syncFromCashfree(order) {
  const cfOrderId = order.payment?.cfOrderId || order.orderNumber;
  const remote = await fetchOrder(cfOrderId);
  let mismatch = false;
  if (paidStatus(remote.order_status)) {
    if (amountMatches(order, remote.order_amount, remote.order_currency || 'INR')) {
      await fulfillPaidOrder(order, { gatewayRef: remote.cf_order_id, note: 'Verified with Cashfree' });
    } else {
      mismatch = true;
      await reportAmountMismatch(order, { amount: remote.order_amount, currency: remote.order_currency, source: 'verify' });
    }
  } else if (failedStatus(remote.order_status)) {
    await markFailed(order, `Cashfree status ${remote.order_status}`);
  }
  return { order, remote, mismatch };
}

async function findByCashfreeOrderId(cfOrderId) {
  if (!cfOrderId) return null;
  return Order.findOne({
    $or: [
      { 'payment.cfOrderId': cfOrderId },
      { 'payment.cfNumericId': String(cfOrderId) },
      { orderNumber: cfOrderId },
    ],
  });
}

function timestampMs(timestamp) {
  const n = Number(String(timestamp || '').trim());
  if (!Number.isFinite(n) || n <= 0) return NaN;
  return n < 1e12 ? n * 1000 : n; // seconds vs milliseconds
}

async function verifyWebhookSignature(signature, timestamp, rawBody) {
  if (!signature || !timestamp || rawBody == null) return false;
  const ts = timestampMs(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > WEBHOOK_MAX_SKEW_MS) return false;
  const raw = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
  const creds = await getCredentials();
  if (!creds.secret) return false;
  const expected = Buffer.from(
    crypto.createHmac('sha256', creds.secret).update(String(timestamp) + raw).digest('base64')
  );
  const got = Buffer.from(String(signature).trim());
  if (expected.length !== got.length) return false;
  return crypto.timingSafeEqual(expected, got);
}

async function createRefund(order, { amount, note } = {}) {
  if (order.payment?.status === 'refunded') {
    return { refund_id: order.payment.refundId, already: true };
  }
  if (order.payment?.status !== 'paid') {
    const err = new Error('Only paid orders can be refunded.');
    err.status = 400;
    throw err;
  }
  const total = Number(order.total || 0);
  const already = Number(order.payment?.refundedAmount || 0);
  const remaining = Number((total - already).toFixed(2));
  const refundAmount = Number(Math.min(remaining, Number(amount != null ? amount : remaining)).toFixed(2));
  if (!(refundAmount > 0)) {
    const err = new Error(remaining > 0 ? 'Refund amount must be greater than zero.' : 'This order has already been fully refunded.');
    err.status = 400;
    throw err;
  }
  // Reserve the amount atomically so two concurrent refunds can't exceed the order total.
  const reserved = await Order.findOneAndUpdate(
    { _id: order._id, 'payment.status': 'paid', $expr: { $lte: [{ $add: [{ $ifNull: ['$payment.refundedAmount', 0] }, refundAmount] }, total + AMOUNT_TOLERANCE] } },
    { $inc: { 'payment.refundedAmount': refundAmount } },
    { returnDocument: 'after' }
  );
  if (!reserved) {
    const err = new Error('Refund would exceed the amount paid for this order.');
    err.status = 409;
    throw err;
  }
  const cumulative = Number(reserved.payment.refundedAmount || 0);
  const cfOrderId = order.payment?.cfOrderId || order.orderNumber;
  // Deterministic per refund step, so a retried request is de-duplicated by Cashfree instead of refunding twice.
  const refundId = `rf-${order.orderNumber}-${Math.round(cumulative * 100)}`.slice(0, 40);
  let refund;
  try {
    refund = await cfFetch(`/orders/${encodeURIComponent(cfOrderId)}/refunds`, {
      method: 'POST',
      body: {
        refund_id: refundId,
        refund_amount: refundAmount,
        refund_note: note || `Refund ${order.orderNumber}`,
      },
    });
  } catch (err) {
    await Order.updateOne({ _id: order._id }, { $inc: { 'payment.refundedAmount': -refundAmount } });
    throw err;
  }
  const full = cumulative >= total - AMOUNT_TOLERANCE;
  await Order.updateOne(
    { _id: order._id },
    { $set: { 'payment.refundId': refund.refund_id || refundId, ...(full ? { 'payment.status': 'refunded' } : {}) } }
  );
  order.payment = order.payment || {};
  order.payment.refundedAmount = cumulative;
  order.payment.refundId = refund.refund_id || refundId;
  if (full) order.payment.status = 'refunded';
  return { ...refund, refund_amount: refundAmount };
}

module.exports = {
  getCredentials,
  publicConfig,
  indiaPhone,
  createCheckoutSession,
  fetchOrder,
  fulfillPaidOrder,
  markFailed,
  syncFromCashfree,
  findByCashfreeOrderId,
  verifyWebhookSignature,
  createRefund,
  paidStatus,
  failedStatus,
  amountMatches,
  reportAmountMismatch,
  safeNotify,
};
