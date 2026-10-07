const crypto = require('crypto');
const mongoose = require('mongoose');
const Order = require('../models/Order');
const Cart = require('../models/Cart');
const ReturnRequest = require('../models/ReturnRequest');
const { asyncHandler, escapeRegex } = require('../utils/asyncHandler');
const { quote: quoteCart } = require('../services/checkoutService');
const { findUsableCoupon, recordUsage } = require('../services/couponService');
const { recordFlashSaleOrder } = require('../services/flashSaleService');
const { deductOrderStock, restoreOrderStock } = require('../services/inventoryService');
const { assertTransition, cancelOrder } = require('../services/orderLifecycleService');
const { notify } = require('../services/notificationService');
const cashfree = require('../services/cashfreeService');
const ithink = require('../services/ithinkService');
const { evaluateRequest } = require('../services/returnPolicy');

const ORDER_STATUSES = ['pending_payment', 'paid', 'processing', 'packed', 'shipped', 'delivered', 'cancelled', 'returned'];
const PAYMENT_STATUSES = ['pending', 'paid', 'failed', 'refunded'];
const PAYMENT_METHODS = ['cod', 'upi', 'gateway'];
const ADDRESS_FIELDS = { name: 120, phone: 20, line1: 200, line2: 200, landmark: 120, city: 80, state: 80, pincode: 10, country: 60, email: 120 };

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

// Optional string input: undefined/null -> fallback; non-string -> 400; otherwise trimmed and capped.
function optString(value, max, field, fallback = '') {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'number' && Number.isFinite(value)) value = String(value);
  if (typeof value !== 'string') throw badRequest(`${field} must be text.`);
  return value.trim().slice(0, max);
}

function cleanAddress(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw badRequest('A shipping address is required.');
  const out = {};
  for (const [key, max] of Object.entries(ADDRESS_FIELDS)) {
    const v = optString(raw[key], max, `Address ${key}`);
    if (v) out[key] = v;
  }
  return out;
}

// KS-<base36 time><4 random base36 chars>, e.g. KS-MG3K2Q1A7XQ2.
function makeOrderNumber() {
  const rand = crypto.randomBytes(4).readUInt32BE(0).toString(36).padStart(4, '0').slice(-4);
  return `KS-${Date.now().toString(36)}${rand}`.toUpperCase();
}

async function createWithOrderNumber(data) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await Order.create({ ...data, orderNumber: makeOrderNumber() });
    } catch (err) {
      if (err.code !== 11000 || !err.keyPattern?.orderNumber || attempt >= 4) throw err;
    }
  }
}

exports.create = asyncHandler(async (req, res) => {
  const cart = await Cart.findOne({ userId: req.user._id });
  if (!cart || cart.items.length === 0) {
    return res.status(400).json({ message: 'Your cart is empty.' });
  }
  let input;
  try {
    input = {
      shippingAddress: cleanAddress(req.body.shippingAddress),
      notes: optString(req.body.notes, 1000, 'Notes'),
      phone: optString(req.body.phone, 20, 'Phone'),
      contactName: optString(req.body.contactName, 120, 'Name'),
      couponCode: optString(req.body.couponCode, 40, 'Coupon code').toUpperCase(),
      paymentMethod: optString(req.body.paymentMethod, 20, 'Payment method'),
      upiRef: optString(req.body.upiRef, 64, 'UPI reference'),
    };
  } catch (err) {
    return res.status(err.status || 400).json({ message: err.message });
  }
  const { shippingAddress, notes, phone, contactName, couponCode, paymentMethod, upiRef } = input;
  shippingAddress.pincode = String(shippingAddress.pincode || '').replace(/\D/g, '');
  if (!shippingAddress.line1 || !shippingAddress.city || !/^\d{6}$/.test(shippingAddress.pincode)) {
    return res.status(400).json({ message: 'A complete shipping address with a 6-digit pincode is required.' });
  }
  const orderPhone = String(phone || shippingAddress.phone || req.user.phone || '').replace(/\D/g, '');
  const mobile = orderPhone.length === 12 && orderPhone.startsWith('91')
    ? orderPhone.slice(2)
    : orderPhone.length === 11 && orderPhone.startsWith('0')
      ? orderPhone.slice(1)
      : orderPhone;
  if (!/^[6-9]\d{9}$/.test(mobile)) {
    return res.status(400).json({ message: 'A valid 10-digit Indian mobile number is required.' });
  }

  const priced = await quoteCart({
    items: cart.items.map((i) => i.toObject()),
    couponCode: couponCode || cart.couponCode,
    user: req.user,
    pincode: shippingAddress.pincode,
  });
  if (priced.error) {
    return res.status(400).json({ message: `${priced.error} Please update your bag.`, itemErrors: priced.itemErrors });
  }
  if (!priced.items.length) {
    return res.status(400).json({ message: 'Your cart is empty.' });
  }
  if (!priced.pincode.serviceable) {
    return res.status(400).json({ message: 'We do not deliver to this pincode yet.' });
  }
  if ((couponCode || cart.couponCode) && priced.couponError) {
    return res.status(400).json({ message: priced.couponError });
  }

  const method = PAYMENT_METHODS.includes(paymentMethod) ? paymentMethod : 'cod';
  if (method === 'cod' && !priced.payment.cod) {
    return res.status(400).json({ message: 'Cash on delivery is not available for this order. Please pay online.' });
  }
  if (method === 'upi' && !priced.payment.upi) {
    return res.status(400).json({ message: 'UPI is not available. Please choose another payment method.' });
  }
  if (method === 'gateway' && !priced.payment.gateway) {
    return res.status(400).json({ message: 'Online payment is not configured.' });
  }
  const isCod = method === 'cod';
  const isGateway = method === 'gateway';
  const cfReady = isGateway ? await cashfree.getCredentials() : { enabled: false };
  if (isGateway && !cfReady.enabled) {
    return res.status(400).json({ message: 'Cashfree is not configured. Add App ID and Secret in admin Settings.' });
  }
  if (isGateway && !cashfree.indiaPhone(mobile)) {
    return res.status(400).json({ message: 'Online payment needs a 10-digit Indian mobile number.' });
  }

  const status = isCod ? 'processing' : 'pending_payment';
  const paymentStatus = 'pending';
  const name = contactName || req.user.name || shippingAddress.name;

  const order = await createWithOrderNumber({
    userId: req.user._id,
    email: req.user.email,
    contactName: name,
    phone: mobile,
    items: priced.items,
    subtotal: priced.subtotal,
    discount: priced.discount,
    tax: priced.tax,
    shippingFee: priced.shippingFee,
    total: priced.total,
    couponCode: priced.coupon?.code,
    couponId: priced.coupon?._id,
    offerId: priced.offer?._id,
    offerName: priced.offer?.label || priced.offer?.name,
    shippingAddress: {
      ...shippingAddress,
      name,
      phone: mobile,
    },
    status,
    payment: {
      method,
      gateway: isGateway ? 'cashfree' : null,
      gatewayRef: null,
      upiRef: upiRef || null,
      status: paymentStatus,
    },
    shipment: { carrier: null, waybill: null },
    notes,
    timeline: [{ status, note: `Placed via ${isGateway ? 'cashfree' : method}`, at: new Date() }],
  });

  let checkout = null;
  if (isGateway) {
    // Stock, coupon usage and cart clearing happen in the payment flow once Cashfree confirms payment.
    try {
      checkout = await cashfree.createCheckoutSession(order, {
        req,
        customer: { _id: req.user._id, name: order.contactName, email: req.user.email, phone: order.phone },
      });
    } catch (err) {
      await Order.findByIdAndDelete(order._id);
      return res.status(err.status || 400).json({ message: err.message || 'Could not start Cashfree checkout.' });
    }
  } else {
    try {
      await deductOrderStock(order, { strict: true });
    } catch (err) {
      await Order.findByIdAndDelete(order._id);
      return res.status(err.status || 409).json({ message: err.message || 'Some items are out of stock.' });
    }
    if (priced.coupon) {
      try {
        const coupon = await findUsableCoupon(priced.coupon.code);
        if (!coupon) throw new Error('This coupon is no longer available.');
        await recordUsage({ coupon, user: req.user, order, discount: priced.discount });
      } catch (err) {
        await restoreOrderStock(order);
        await Order.findByIdAndDelete(order._id);
        return res.status(409).json({ message: err.message || 'This coupon can no longer be applied.' });
      }
    }
    await recordFlashSaleOrder(order).catch((err) => console.warn('[orders] flash sale stats:', err.message));

    await notify({
      type: 'new_order',
      title: `New order ${order.orderNumber}`,
      body: `${order.contactName} · ₹${order.total} · ${method}`,
      link: '/admin/orders',
      meta: { orderId: order._id, total: order.total },
    });

    cart.items = [];
    cart.couponCode = '';
    await cart.save();
  }

  const fresh = (await Order.findById(order._id)) || order;
  res.status(201).json({
    order: fresh,
    cashfree: checkout,
  });
});

exports.mine = asyncHandler(async (req, res) => {
  const orders = await Order.find({ userId: req.user._id }).sort({ createdAt: -1 }).lean();
  res.json({ orders });
});

exports.getOne = asyncHandler(async (req, res) => {
  const order = await Order.findOne({ _id: req.params.id, userId: req.user._id }).lean();
  if (!order) return res.status(404).json({ message: 'Order not found.' });
  res.json({ order });
});

exports.adminList = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  const q = String(req.query.q || '').trim();
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [
      { orderNumber: rx },
      { email: rx },
      { contactName: rx },
      { phone: rx },
      { 'items.snapshot.name': rx },
      { 'items.name': rx },
    ];
  }
  const [orders, statusRows] = await Promise.all([
    Order.find(filter).populate('userId', 'name email').sort({ createdAt: -1 }).lean(),
    Order.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
  ]);
  const statusCounts = { all: 0 };
  for (const row of statusRows) {
    statusCounts[row._id] = row.n;
    statusCounts.all += row.n;
  }
  res.json({ orders, statusCounts });
});

exports.adminUpdate = asyncHandler(async (req, res) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) return res.status(404).json({ message: 'Order not found.' });
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ message: 'Order not found.' });
  const prev = order.status;
  const body = req.body || {};

  let input;
  try {
    input = {
      status: optString(body.status, 30, 'Status'),
      paymentStatus: optString(body.paymentStatus, 20, 'Payment status'),
      paymentMethod: optString(body.paymentMethod, 20, 'Payment method'),
      timelineNote: optString(body.timelineNote, 300, 'Timeline note'),
    };
    if (input.status && !ORDER_STATUSES.includes(input.status)) throw badRequest('Unknown order status.');
    if (input.paymentStatus && !PAYMENT_STATUSES.includes(input.paymentStatus)) throw badRequest('Unknown payment status.');
    if (input.paymentMethod && !PAYMENT_METHODS.includes(input.paymentMethod)) throw badRequest('Unknown payment method.');
    if (input.status) assertTransition(prev, input.status);
    for (const [key, max] of [['notes', 2000], ['carrier', 120], ['waybill', 120], ['trackingUrl', 500], ['gatewayRef', 200], ['upiRef', 64]]) {
      if (body[key] !== undefined) input[key] = optString(body[key], max, key, null);
    }
  } catch (err) {
    return res.status(err.status || 400).json({ message: err.message });
  }

  const cancelling = input.status === 'cancelled' && prev !== 'cancelled';
  if (input.status && !cancelling) order.status = input.status;
  if (input.notes !== undefined) order.notes = input.notes || '';
  order.shipment = order.shipment || {};
  if (input.carrier !== undefined) order.shipment.carrier = input.carrier || null;
  if (input.waybill !== undefined) order.shipment.waybill = input.waybill || null;
  if (input.trackingUrl !== undefined) order.shipment.trackingUrl = input.trackingUrl || null;
  order.payment = order.payment || {};
  const prevPayment = order.payment.status;
  if (input.paymentStatus) order.payment.status = input.paymentStatus;
  if (input.paymentMethod) order.payment.method = input.paymentMethod;
  if (input.gatewayRef !== undefined) order.payment.gatewayRef = input.gatewayRef || null;
  if (input.upiRef !== undefined) order.payment.upiRef = input.upiRef || null;
  const markedPaid = input.paymentStatus === 'paid' && prevPayment !== 'paid';
  if (input.paymentStatus === 'paid') {
    if (markedPaid) {
      order.payment.capturedAt = new Date();
      // Side effects run right here, so the payment flow must not run them again later.
      order.payment.fulfilledAt = order.payment.fulfilledAt || new Date();
    }
    if (!input.status && order.status === 'pending_payment') order.status = 'paid';
  }
  if (input.paymentStatus === 'failed') {
    await notify({
      type: 'payment_failed',
      title: `Payment failed for ${order.orderNumber}`,
      body: `${order.contactName} · ₹${order.total}`,
      link: '/admin/orders',
    });
  }
  if (cancelling && order.shipment?.waybill) {
    try {
      await ithink.cancelShipment(order.shipment.waybill);
      order.timeline = order.timeline || [];
      order.timeline.push({ status: prev, note: 'iThink shipment cancelled', at: new Date() });
    } catch (err) {
      order.timeline = order.timeline || [];
      order.timeline.push({ status: prev, note: `iThink cancel failed: ${err.message}`, at: new Date() });
    }
  }
  if (!cancelling && ((input.status && input.status !== prev) || input.paymentStatus)) {
    order.timeline = order.timeline || [];
    order.timeline.push({
      status: order.status,
      note: input.timelineNote || (input.paymentStatus ? `Payment ${input.paymentStatus}` : ''),
      at: new Date(),
    });
  }
  await order.save();

  // Manually confirmed payment: commit stock / coupon like the gateway flow would (both idempotent).
  if (markedPaid && !cancelling && order.status !== 'cancelled') {
    try {
      await deductOrderStock(order, { strict: false });
    } catch (err) {
      console.error('[orders] stock deduction after manual payment failed:', err.message);
    }
    if (order.couponCode) {
      try {
        const coupon = await findUsableCoupon(order.couponCode);
        if (coupon) await recordUsage({ coupon, user: { _id: order.userId }, order, discount: order.discount });
      } catch (err) {
        console.error('[orders] coupon usage after manual payment failed:', err.message);
      }
    }
  }

  if (cancelling) {
    // cancelOrder restores stock, releases the coupon and flags refunds for paid orders.
    const cancelled = await cancelOrder(order, { note: input.timelineNote || 'Cancelled by admin', by: 'admin' });
    return res.json({ order: cancelled });
  }
  res.json({ order: await Order.findById(order._id) });
});

exports.verifyCashfree = asyncHandler(async (req, res) => {
  const order = await Order.findOne({ _id: req.params.id, userId: req.user._id });
  if (!order) return res.status(404).json({ message: 'Order not found.' });
  if (order.payment?.method !== 'gateway') {
    return res.json({ order, paid: order.payment?.status === 'paid' });
  }
  const { remote } = await cashfree.syncFromCashfree(order);
  const fresh = await Order.findById(order._id);
  res.json({ order: fresh, remote, paid: fresh.payment?.status === 'paid' });
});

exports.retryCashfree = asyncHandler(async (req, res) => {
  const order = await Order.findOne({ _id: req.params.id, userId: req.user._id });
  if (!order) return res.status(404).json({ message: 'Order not found.' });
  if (order.payment?.status === 'paid') return res.json({ order, cashfree: null, paid: true });
  if (order.payment?.method !== 'gateway') {
    return res.status(400).json({ message: 'This order is not a Cashfree payment.' });
  }
  if (order.status !== 'pending_payment') {
    return res.status(409).json({ message: 'This order can no longer be paid. Please place a new order.' });
  }
  const checkout = await cashfree.createCheckoutSession(order, {
    req,
    customer: { _id: req.user._id, name: order.contactName, email: req.user.email, phone: order.phone },
  });
  if (checkout.alreadyPaid) {
    const fresh = await Order.findById(order._id);
    return res.json({ order: fresh, cashfree: null, paid: true });
  }
  res.json({ order, cashfree: checkout, paid: false });
});

// Resolves client-selected return lines against the order's own lines. Returns null if the selection is invalid.
function resolveReturnLines(order, requested) {
  const lines = order.items || [];
  if (requested === undefined || requested === null || (Array.isArray(requested) && !requested.length)) {
    return lines.map((line, index) => ({ line, index, quantity: Math.max(1, Math.floor(Number(line.quantity) || 1)) }));
  }
  if (!Array.isArray(requested)) return null;
  const picked = new Map();
  for (const raw of requested.slice(0, lines.length * 2)) {
    if (!raw || typeof raw !== 'object') continue;
    let index = Number.isInteger(raw.index) ? raw.index : Number.isInteger(raw.lineIndex) ? raw.lineIndex : -1;
    if (index < 0 && raw.productId) {
      index = lines.findIndex((l, i) => !picked.has(i) && l.productId && String(l.productId) === String(raw.productId));
    }
    const line = lines[index];
    if (!line) continue; // not part of this order
    const ordered = Math.max(1, Math.floor(Number(line.quantity) || 1));
    const qty = raw.quantity === undefined ? ordered : Number(raw.quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > ordered) return null;
    picked.set(index, { line, index, quantity: qty });
  }
  return picked.size ? [...picked.values()] : null;
}

exports.requestReturn = asyncHandler(async (req, res) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) return res.status(404).json({ message: 'Order not found.' });
  const order = await Order.findOne({ _id: req.params.id, userId: req.user._id });
  if (!order) return res.status(404).json({ message: 'Order not found.' });
  const type = req.body.type === 'exchange' ? 'exchange' : 'return';
  const reasonCode = typeof req.body.reasonCode === 'string' ? req.body.reasonCode.trim().slice(0, 60) : '';
  const verdict = evaluateRequest({ order, type, reasonCode });
  if (!verdict.ok) return res.status(400).json({ message: verdict.message });
  const existing = await ReturnRequest.findOne({ orderId: order._id, status: { $in: ['requested', 'approved'] } });
  if (existing) return res.status(409).json({ message: 'A return or exchange is already open for this order.' });

  const selected = resolveReturnLines(order, req.body.items);
  if (!selected) return res.status(400).json({ message: 'Choose valid items and quantities from this order.' });

  // Refund = what was paid for the returned units, less their share of the order discount; never from the client.
  const subtotal = Number(order.subtotal) || 0;
  const discount = Math.max(0, Number(order.discount) || 0);
  const items = selected.map(({ line, index, quantity }) => {
    const ordered = Math.max(1, Math.floor(Number(line.quantity) || 1));
    const lineTotal = Math.max(0, Number(line.lineTotal) || 0);
    const gross = (lineTotal / ordered) * quantity;
    const share = subtotal > 0 ? (discount * gross) / subtotal : 0;
    return {
      name: line.snapshot?.name || line.name,
      productId: mongoose.isObjectIdOrHexString(line.productId) ? line.productId : undefined,
      lineIndex: index,
      quantity,
      amount: Math.max(0, Math.round(gross - share)),
    };
  });
  const computed = items.reduce((sum, i) => sum + i.amount, 0);
  const refundAmount = type === 'exchange' ? 0 : Math.min(Math.max(0, Number(order.total) || 0), computed);

  const reason = (typeof req.body.reason === 'string' && req.body.reason.trim().slice(0, 1000)) || verdict.reasonLabel;
  let doc;
  try {
    doc = await ReturnRequest.create({
      orderId: order._id,
      userId: req.user._id,
      type,
      reasonCode,
      reason,
      items,
      refundAmount,
      timeline: [{ status: 'requested', note: reason, at: new Date() }],
    });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: 'A return or exchange is already open for this order.' });
    throw err;
  }
  await notify({
    type: 'return',
    title: `${type === 'exchange' ? 'Exchange' : 'Return'} requested for ${order.orderNumber}`,
    body: reason,
    link: '/admin/returns',
  });
  res.status(201).json({ return: doc });
});

function applyForwardBooking(order, booked) {
  order.shipment = order.shipment || {};
  order.shipment.provider = 'ithink';
  order.shipment.carrier = booked.carrier || order.shipment.carrier;
  order.shipment.waybill = booked.waybill;
  order.shipment.trackingUrl = booked.trackingUrl;
  order.shipment.orderType = 'forward';
  order.shipment.bookedAt = new Date();
  if (!['shipped', 'delivered'].includes(order.status)) order.status = 'shipped';
  order.timeline = order.timeline || [];
  order.timeline.push({
    status: order.status,
    note: `iThink booked ${booked.waybill}${booked.carrier ? ` via ${booked.carrier}` : ''}`,
    at: new Date(),
  });
}

async function applyTracking(order, tracking, target = 'forward') {
  return ithink.applyTrackingToOrder(order, tracking, target);
}

exports.adminShip = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ message: 'Order not found.' });
  if (order.status === 'pending_payment' || (order.payment?.method === 'gateway' && order.payment?.status !== 'paid')) {
    return res.status(400).json({ message: 'Wait for payment confirmation before booking a shipment.' });
  }
  if (['cancelled', 'returned'].includes(order.status)) {
    return res.status(400).json({ message: 'This order cannot be shipped in its current status.' });
  }
  if (order.shipment?.waybill && !req.body.force) {
    return res.status(409).json({ message: 'A shipment is already booked. Refresh tracking or cancel it first.' });
  }
  const suffix = order.shipment?.waybill ? `-F${Date.now().toString().slice(-4)}` : '';
  const booked = await ithink.addOrder(order, { orderType: 'forward', orderNumber: `${order.orderNumber}${suffix}` });
  applyForwardBooking(order, booked);
  await order.save();
  res.json({ order, shipment: booked });
});

exports.adminCancelShipment = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ message: 'Order not found.' });
  if (!order.shipment?.waybill) return res.status(400).json({ message: 'No iThink shipment to cancel.' });
  const remote = await ithink.cancelShipment(order.shipment.waybill);
  order.timeline = order.timeline || [];
  order.timeline.push({ status: order.status, note: `iThink shipment ${order.shipment.waybill} cancelled`, at: new Date() });
  order.shipment.waybill = null;
  order.shipment.trackingUrl = null;
  order.shipment.lastStatus = 'Cancelled';
  if (order.status === 'shipped') order.status = 'processing';
  await order.save();
  res.json({ order, remote });
});

async function trackOrderDoc(order) {
  const result = { forward: null, reverse: null };
  if (order.shipment?.waybill) {
    result.forward = await ithink.track(order.shipment.waybill);
    await applyTracking(order, result.forward, 'forward');
  }
  if (order.shipment?.returnWaybill) {
    result.reverse = await ithink.track(order.shipment.returnWaybill);
    await applyTracking(order, result.reverse, 'return');
  }
  await order.save();
  return result;
}

exports.adminTrack = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ message: 'Order not found.' });
  if (!order.shipment?.waybill && !order.shipment?.returnWaybill) {
    return res.status(400).json({ message: 'No iThink waybill on this order yet.' });
  }
  const tracking = await trackOrderDoc(order);
  res.json({ order, tracking });
});

exports.customerTrack = asyncHandler(async (req, res) => {
  const order = await Order.findOne({ _id: req.params.id, userId: req.user._id });
  if (!order) return res.status(404).json({ message: 'Order not found.' });
  if (!order.shipment?.waybill && !order.shipment?.returnWaybill) {
    return res.json({ order, tracking: null });
  }
  const tracking = await trackOrderDoc(order);
  res.json({ order, tracking });
});
