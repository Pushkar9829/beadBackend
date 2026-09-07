const Order = require('../models/Order');
const Cart = require('../models/Cart');
const { asyncHandler } = require('../utils/asyncHandler');

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
  const orders = await Order.find(filter).populate('userId', 'name email').sort({ createdAt: -1 }).lean();
  res.json({ orders });
});

exports.adminUpdate = asyncHandler(async (req, res) => {
  const order = await Order.findByIdAndUpdate(
    req.params.id,
    {
      status: req.body.status,
      notes: req.body.notes,
      'shipment.carrier': req.body.carrier,
      'shipment.waybill': req.body.waybill,
    },
    { new: true }
  );
  if (!order) return res.status(404).json({ message: 'Order not found.' });
  res.json({ order });
});
