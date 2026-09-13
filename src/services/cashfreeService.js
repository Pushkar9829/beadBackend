const crypto = require('crypto');
const StoreSettings = require('../models/StoreSettings');
const { publicApiOrigin } = require('../lib/publicUrl');
const Order = require('../models/Order');
const Product = require('../models/Product');
const { findUsableCoupon, recordUsage } = require('./couponService');
const { recordFlashSaleOrder } = require('./flashSaleService');
const { notify } = require('./notificationService');

const API_VERSION = '2025-01-01';

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
  const res = await fetch(`${baseUrl(creds.env)}${path}`, {
    method,
    headers: headers(creds),
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data.message || data.error || `Cashfree request failed (${res.status}).`;
    const err = new Error(message);
    err.status = res.status >= 400 && res.status < 500 ? 400 : 502;
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
    const exists = /already exists|duplicate|order_id/i.test(err.message || '');
    if (!exists) throw err;
    session = await cfFetch(`/orders/${encodeURIComponent(cfOrderId)}`);
    if (paidStatus(session.order_status)) {
      await fulfillPaidOrder(order, { gatewayRef: session.cf_order_id, note: 'Cashfree order already paid' });
      return {
        paymentSessionId: session.payment_session_id || order.payment?.sessionId || '',
        orderId: session.order_id || payload.order_id,
        cfOrderId: session.cf_order_id || null,
        env: creds.env,
        appId: creds.appId,
        orderStatus: session.order_status,
        alreadyPaid: true,
      };
    }
    if (session.order_status && session.order_status !== 'ACTIVE' && session.order_status !== 'PENDING') {
      payload.order_id = `${order.orderNumber}-${Date.now().toString(36)}`;
      session = await cfFetch('/orders', { method: 'POST', body: payload });
    }
  }

  order.payment = order.payment || {};
  order.payment.method = 'gateway';
  order.payment.gateway = 'cashfree';
  order.payment.cfOrderId = session.order_id || payload.order_id;
  order.payment.sessionId = session.payment_session_id || '';
  if (session.cf_order_id) order.payment.cfNumericId = String(session.cf_order_id);
  if (!order.payment.sessionId) {
    const err = new Error('Cashfree did not return a payment session. Check App ID, secret, and environment.');
    err.status = 502;
    throw err;
  }
  await order.save();

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

async function fulfillPaidOrder(order, { gatewayRef, note } = {}) {
  if (!order?._id) return order;
  if (order.payment?.status === 'paid' && order.payment?.fulfilledAt) return order;
  const now = new Date();
  const nextStatus = order.status === 'pending_payment' ? 'paid' : order.status;
  const claimed = await Order.findOneAndUpdate(
    { _id: order._id, 'payment.status': { $ne: 'paid' } },
    {
      $set: {
        'payment.status': 'paid',
        'payment.capturedAt': now,
        'payment.fulfilledAt': now,
        ...(gatewayRef ? { 'payment.gatewayRef': String(gatewayRef) } : {}),
        status: nextStatus,
      },
      $push: { timeline: { status: nextStatus, note: note || 'Cashfree payment captured', at: now } },
    },
    { new: true }
  );
  if (!claimed) {
    const fresh = await Order.findById(order._id);
    return fresh || order;
  }
  order.payment = claimed.payment;
  order.status = claimed.status;
  order.timeline = claimed.timeline;

  for (const item of order.items || []) {
    if (item.kind !== 'product' || !item.productId) continue;
    const product = await Product.findById(item.productId);
    if (!product) continue;
    const previousStock = product.stock || 0;
    product.stock = Math.max(0, previousStock - (item.quantity || 1));
    await product.save();
    if (product.stock <= 0) {
      await notify({
        type: 'out_of_stock',
        title: `${product.name} is out of stock`,
        body: `Stock hit 0 after order ${order.orderNumber}.`,
        link: '/admin/inventory',
      });
    } else if (product.stock <= (product.lowStockLimit ?? 5)) {
      await notify({
        type: 'low_stock',
        title: `${product.name} is low on stock`,
        body: `Stock is ${product.stock} after order ${order.orderNumber}.`,
        link: '/admin/inventory/low',
      });
    }
  }

  if (order.couponCode) {
    const coupon = await findUsableCoupon(order.couponCode);
    if (coupon) await recordUsage({ coupon, user: { _id: order.userId }, order, discount: order.discount });
  }
  await recordFlashSaleOrder(order);
  await notify({
    type: 'new_order',
    title: `Paid order ${order.orderNumber}`,
    body: `${order.contactName} · ₹${order.total} · Cashfree`,
    link: '/admin/orders',
    meta: { orderId: order._id, total: order.total },
  });
  return order;
}

async function markFailed(order, note) {
  if (order.payment?.status === 'paid') return order;
  order.payment = order.payment || {};
  order.payment.status = 'failed';
  order.timeline = order.timeline || [];
  order.timeline.push({ status: order.status, note: note || 'Cashfree payment failed', at: new Date() });
  await order.save();
  await notify({
    type: 'payment_failed',
    title: `Payment failed for ${order.orderNumber}`,
    body: `${order.contactName} · ₹${order.total}`,
    link: '/admin/orders',
  });
  return order;
}

async function syncFromCashfree(order) {
  const cfOrderId = order.payment?.cfOrderId || order.orderNumber;
  const remote = await fetchOrder(cfOrderId);
  if (paidStatus(remote.order_status)) {
    await fulfillPaidOrder(order, { gatewayRef: remote.cf_order_id, note: 'Verified with Cashfree' });
  } else if (failedStatus(remote.order_status)) {
    await markFailed(order, `Cashfree status ${remote.order_status}`);
  }
  return { order, remote };
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

function verifyWebhookSignature(signature, timestamp, rawBody) {
  if (!signature || !timestamp || rawBody == null) return false;
  const raw = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
  const got = String(signature).trim();
  return getCredentials().then((creds) => {
    if (!creds.secret) return false;
    const expected = crypto.createHmac('sha256', creds.secret).update(String(timestamp) + raw).digest('base64');
    try {
      const left = Buffer.from(expected);
      const right = Buffer.from(got);
      if (left.length !== right.length) return expected === got;
      return crypto.timingSafeEqual(left, right);
    } catch {
      return expected === got;
    }
  });
}

async function createRefund(order, { amount, note } = {}) {
  if (order.payment?.refundId && order.payment?.status === 'refunded') {
    return { refund_id: order.payment.refundId, already: true };
  }
  const cfOrderId = order.payment?.cfOrderId || order.orderNumber;
  const refundId = `rf-${order.orderNumber}-${Date.now().toString(36)}`.slice(0, 40);
  const refund = await cfFetch(`/orders/${encodeURIComponent(cfOrderId)}/refunds`, {
    method: 'POST',
    body: {
      refund_id: refundId,
      refund_amount: Number(Number(amount != null ? amount : order.total).toFixed(2)),
      refund_note: note || `Refund ${order.orderNumber}`,
    },
  });
  order.payment = order.payment || {};
  order.payment.status = 'refunded';
  order.payment.refundId = refund.refund_id || refundId;
  await order.save();
  return refund;
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
};
