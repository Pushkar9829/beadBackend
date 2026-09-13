const Order = require('../models/Order');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const ReturnRequest = require('../models/ReturnRequest');
const { asyncHandler, escapeRegex } = require('../utils/asyncHandler');
const { quote: quoteCart } = require('../services/checkoutService');
const { findUsableCoupon, recordUsage } = require('../services/couponService');
const { recordFlashSaleOrder } = require('../services/flashSaleService');
const { notify } = require('../services/notificationService');
const cashfree = require('../services/cashfreeService');
const ithink = require('../services/ithinkService');
const { evaluateRequest } = require('../services/returnPolicy');

function makeOrderNumber() {
  const n = Math.floor(100000 + Math.random() * 900000);
  return `KS-${n}`;
}

exports.create = asyncHandler(async (req, res) => {
  const cart = await Cart.findOne({ userId: req.user._id });
  if (!cart || cart.items.length === 0) {
    return res.status(400).json({ message: 'Your cart is empty.' });
  }
  const { shippingAddress, notes, phone, contactName, couponCode, paymentMethod, upiRef } = req.body;
  if (!shippingAddress?.line1 || !shippingAddress?.city || !shippingAddress?.pincode) {
    return res.status(400).json({ message: 'A complete shipping address is required.' });
  }

  const priced = await quoteCart({
    items: cart.items.map((i) => i.toObject()),
    couponCode: couponCode || cart.couponCode,
    user: req.user,
    pincode: shippingAddress.pincode,
  });
  if (!priced.pincode.serviceable) {
    return res.status(400).json({ message: 'We do not deliver to this pincode yet.' });
  }
  if ((couponCode || cart.couponCode) && priced.couponError) {
    return res.status(400).json({ message: priced.couponError });
  }

  const method = ['cod', 'upi', 'gateway'].includes(paymentMethod) ? paymentMethod : 'cod';
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
  if (isGateway && !cashfree.indiaPhone(phone || req.user.phone)) {
    return res.status(400).json({ message: 'Online payment needs a 10-digit Indian mobile number.' });
  }

  const status = isCod ? 'processing' : 'pending_payment';
  const paymentStatus = 'pending';

  const order = await Order.create({
    orderNumber: makeOrderNumber(),
    userId: req.user._id,
    email: req.user.email,
    contactName: contactName || req.user.name,
    phone: phone || req.user.phone,
    items: priced.items,
    subtotal: priced.subtotal,
    discount: priced.discount,
    tax: priced.tax,
    shippingFee: priced.shippingFee,
    total: priced.total,
    couponCode: priced.coupon?.code,
    couponId: priced.coupon?._id,
    shippingAddress: {
      ...shippingAddress,
      name: contactName || req.user.name || shippingAddress.name,
      phone: phone || req.user.phone || shippingAddress.phone,
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
    if (priced.coupon) {
      const coupon = await findUsableCoupon(priced.coupon.code);
      if (coupon) await recordUsage({ coupon, user: req.user, order, discount: priced.discount });
    }
    await recordFlashSaleOrder(order);

    for (const item of priced.items) {
      if (item.kind === 'product' && item.productId) {
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
    }

    await notify({
      type: 'new_order',
      title: `New order ${order.orderNumber}`,
      body: `${order.contactName} · ₹${order.total} · ${method}`,
      link: '/admin/orders',
      meta: { orderId: order._id, total: order.total },
    });
  }

  cart.items = [];
  cart.couponCode = '';
  await cart.save();
  res.status(201).json({
    order,
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
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ message: 'Order not found.' });
  const prev = order.status;
  if (req.body.status) order.status = req.body.status;
  if (req.body.notes !== undefined) order.notes = req.body.notes;
  order.shipment = order.shipment || {};
  if (req.body.carrier !== undefined) order.shipment.carrier = req.body.carrier;
  if (req.body.waybill !== undefined) order.shipment.waybill = req.body.waybill;
  if (req.body.trackingUrl !== undefined) order.shipment.trackingUrl = req.body.trackingUrl;
  order.payment = order.payment || {};
  if (req.body.paymentStatus) order.payment.status = req.body.paymentStatus;
  if (req.body.paymentMethod) order.payment.method = req.body.paymentMethod;
  if (req.body.gatewayRef !== undefined) order.payment.gatewayRef = req.body.gatewayRef;
  if (req.body.upiRef !== undefined) order.payment.upiRef = req.body.upiRef;
  if (req.body.paymentStatus === 'paid') {
    order.payment.capturedAt = new Date();
    if (!req.body.status && order.status === 'pending_payment') order.status = 'paid';
  }
  if (req.body.paymentStatus === 'failed') {
    await notify({
      type: 'payment_failed',
      title: `Payment failed for ${order.orderNumber}`,
      body: `${order.contactName} · ₹${order.total}`,
      link: '/admin/orders',
    });
  }
  if (req.body.status === 'cancelled' && order.shipment?.waybill && prev !== 'cancelled') {
    try {
      await ithink.cancelShipment(order.shipment.waybill);
      order.timeline = order.timeline || [];
      order.timeline.push({ status: 'cancelled', note: 'iThink shipment cancelled', at: new Date() });
    } catch (err) {
      order.timeline = order.timeline || [];
      order.timeline.push({ status: 'cancelled', note: `iThink cancel failed: ${err.message}`, at: new Date() });
    }
  }
  if ((req.body.status && req.body.status !== prev) || req.body.paymentStatus) {
    order.timeline = order.timeline || [];
    order.timeline.push({
      status: req.body.status || order.status,
      note: req.body.timelineNote || (req.body.paymentStatus ? `Payment ${req.body.paymentStatus}` : ''),
      at: new Date(),
    });
  }
  await order.save();
  res.json({ order });
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

exports.requestReturn = asyncHandler(async (req, res) => {
  const order = await Order.findOne({ _id: req.params.id, userId: req.user._id });
  if (!order) return res.status(404).json({ message: 'Order not found.' });
  const type = req.body.type === 'exchange' ? 'exchange' : 'return';
  const reasonCode = String(req.body.reasonCode || '').trim();
  const verdict = evaluateRequest({ order, type, reasonCode });
  if (!verdict.ok) return res.status(400).json({ message: verdict.message });
  const existing = await ReturnRequest.findOne({ orderId: order._id, status: { $in: ['requested', 'approved'] } });
  if (existing) return res.status(409).json({ message: 'A return or exchange is already open for this order.' });
  const reason = req.body.reason || verdict.reasonLabel;
  const doc = await ReturnRequest.create({
    orderId: order._id,
    userId: req.user._id,
    type,
    reasonCode,
    reason,
    items: (req.body.items || order.items || []).map((i) => ({
      name: i.snapshot?.name || i.name,
      productId: i.productId,
      quantity: i.quantity || 1,
    })),
    refundAmount: type === 'exchange' ? 0 : (req.body.refundAmount != null ? Number(req.body.refundAmount) : order.total),
    timeline: [{ status: 'requested', note: reason, at: new Date() }],
  });
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
