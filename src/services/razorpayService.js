const crypto = require('crypto');
const StoreSettings = require('../models/StoreSettings');
const Order = require('../models/Order');
const { publicApiOrigin } = require('../lib/publicUrl');
const cashfree = require('./cashfreeService');

function basicAuth(keyId, secret) {
  return `Basic ${Buffer.from(`${keyId}:${secret}`).toString('base64')}`;
}

async function getCredentials() {
  const stored = await StoreSettings.findOne({ key: 'store' }).lean();
  const pay = stored?.payment || {};
  const keyId = String(pay.razorpayKeyId || pay.gatewayKeyId || process.env.RAZORPAY_KEY_ID || '').trim();
  const secret = String(pay.razorpaySecret || process.env.RAZORPAY_KEY_SECRET || '').trim();
  const webhookSecret = String(pay.razorpayWebhookSecret || process.env.RAZORPAY_WEBHOOK_SECRET || '').trim();
  const enabled = pay.razorpayEnabled !== false && Boolean(keyId && secret);
  return { keyId, secret, webhookSecret, enabled };
}

async function publicConfig() {
  const { keyId, enabled } = await getCredentials();
  return { enabled, keyId: enabled ? keyId : '' };
}

async function rzpFetch(path, { method = 'GET', body } = {}) {
  const creds = await getCredentials();
  if (!creds.enabled) {
    const err = new Error('Razorpay is not configured. Add Key ID and Secret in Settings.');
    err.status = 400;
    throw err;
  }
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    method,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: basicAuth(creds.keyId, creds.secret),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data.error?.description || data.error?.reason || data.message || `Razorpay request failed (${res.status}).`;
    const err = new Error(message);
    err.status = res.status >= 400 && res.status < 500 ? 400 : 502;
    err.details = data;
    throw err;
  }
  return data;
}

function paise(amount) {
  return Math.max(100, Math.round(Number(amount || 0) * 100));
}

async function createOrder(order, { customer } = {}) {
  const creds = await getCredentials();
  if (!creds.enabled) {
    const err = new Error('Razorpay is not configured.');
    err.status = 400;
    throw err;
  }
  const phone = cashfree.indiaPhone(customer?.phone || order.phone);
  if (!phone) {
    const err = new Error('Razorpay needs a 10-digit Indian mobile number.');
    err.status = 400;
    throw err;
  }

  const remote = await rzpFetch('/orders', {
    method: 'POST',
    body: {
      amount: paise(order.total),
      currency: 'INR',
      receipt: String(order.orderNumber).slice(0, 40),
      notes: {
        orderNumber: order.orderNumber,
        orderId: String(order._id),
      },
    },
  });

  order.payment = order.payment || {};
  order.payment.method = 'gateway';
  order.payment.gateway = 'razorpay';
  order.payment.rzpOrderId = remote.id;
  await order.save();

  return {
    orderId: remote.id,
    amount: remote.amount,
    currency: remote.currency || 'INR',
    keyId: creds.keyId,
    name: 'Kuberstones',
    description: `Kuberstones ${order.orderNumber}`,
    prefill: {
      name: customer?.name || order.contactName || '',
      email: customer?.email || order.email || '',
      contact: phone,
    },
    notes: { orderNumber: order.orderNumber },
  };
}

function verifyCheckoutSignature({ razorpay_order_id, razorpay_payment_id, razorpay_signature }, secret) {
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !secret) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(razorpay_signature)));
  } catch {
    return expected === razorpay_signature;
  }
}

function verifyWebhookSignature(rawBody, signature, secret) {
  if (!signature || rawBody == null || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(String(rawBody)).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(signature)));
  } catch {
    return expected === signature;
  }
}

async function findByRazorpayIds({ rzpOrderId, rzpPaymentId, receipt, orderNumber }) {
  const clauses = [];
  if (rzpOrderId) clauses.push({ 'payment.rzpOrderId': rzpOrderId });
  if (rzpPaymentId) clauses.push({ 'payment.rzpPaymentId': rzpPaymentId });
  if (receipt) clauses.push({ orderNumber: receipt });
  if (orderNumber) clauses.push({ orderNumber });
  if (!clauses.length) return null;
  return Order.findOne({ $or: clauses });
}

async function verifyAndFulfill(order, payload) {
  const creds = await getCredentials();
  const ok = verifyCheckoutSignature(payload, creds.secret);
  if (!ok) {
    const err = new Error('Invalid Razorpay checkout signature.');
    err.status = 400;
    throw err;
  }
  if (payload.razorpay_order_id && order.payment?.rzpOrderId && payload.razorpay_order_id !== order.payment.rzpOrderId) {
    const err = new Error('Razorpay order does not match this Kuberstones order.');
    err.status = 400;
    throw err;
  }
  order.payment = order.payment || {};
  order.payment.rzpOrderId = payload.razorpay_order_id || order.payment.rzpOrderId;
  order.payment.rzpPaymentId = payload.razorpay_payment_id;
  await cashfree.fulfillPaidOrder(order, {
    gatewayRef: payload.razorpay_payment_id,
    note: 'Razorpay checkout verified',
  });
  return Order.findById(order._id);
}

async function createRefund(order, { amount, note } = {}) {
  const paymentId = order.payment?.rzpPaymentId || order.payment?.gatewayRef;
  if (!paymentId) {
    const err = new Error('No Razorpay payment id to refund.');
    err.status = 400;
    throw err;
  }
  const refund = await rzpFetch(`/payments/${encodeURIComponent(paymentId)}/refund`, {
    method: 'POST',
    body: {
      amount: paise(amount != null ? amount : order.total),
      notes: { orderNumber: order.orderNumber, note: note || `Refund ${order.orderNumber}` },
    },
  });
  order.payment = order.payment || {};
  order.payment.status = 'refunded';
  order.payment.refundId = refund.id;
  await order.save();
  return refund;
}

function webhookUrl(req) {
  return `${publicApiOrigin(req)}/api/payments/razorpay/webhook`;
}

module.exports = {
  getCredentials,
  publicConfig,
  createOrder,
  verifyCheckoutSignature,
  verifyWebhookSignature,
  findByRazorpayIds,
  verifyAndFulfill,
  createRefund,
  webhookUrl,
};
