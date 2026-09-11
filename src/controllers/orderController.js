const Order = require('../models/Order');
const Cart = require('../models/Cart');
const { asyncHandler, escapeRegex } = require('../utils/asyncHandler');

function makeOrderNumber() {
  const n = Math.floor(100000 + Math.random() * 900000);
  return `KS-${n}`;
}

exports.create = asyncHandler(async (req, res) => {
  const cart = await Cart.findOne({ userId: req.user._id });
  if (!cart || cart.items.length === 0) {
    return res.status(400).json({ message: 'Your cart is empty.' });
  }
  const { shippingAddress, notes, phone, contactName } = req.body;
  if (!shippingAddress?.line1 || !shippingAddress?.city || !shippingAddress?.pincode) {
    return res.status(400).json({ message: 'A complete shipping address is required.' });
  }

  const subtotal = cart.items.reduce((s, i) => s + i.lineTotal, 0);
  const shippingFee = 0;
  const order = await Order.create({
    orderNumber: makeOrderNumber(),
    userId: req.user._id,
    email: req.user.email,
    contactName: contactName || req.user.name,
    phone: phone || req.user.phone,
    items: cart.items.map((i) => i.toObject()),
    subtotal,
    shippingFee,
    total: subtotal + shippingFee,
    shippingAddress,
    status: 'pending_payment',
    payment: { gateway: null, gatewayRef: null },
    shipment: { carrier: null, waybill: null },
    notes,
    timeline: [{ status: 'pending_payment', note: 'Placed', at: new Date() }],
  });

  cart.items = [];
  await cart.save();
  res.status(201).json({ order });
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
  if (req.body.status && req.body.status !== prev) {
    order.timeline = order.timeline || [];
    order.timeline.push({ status: req.body.status, note: req.body.timelineNote || '', at: new Date() });
  }
  await order.save();
  res.json({ order });
});
