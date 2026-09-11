const Product = require('../models/Product');
const Bead = require('../models/Bead');
const Order = require('../models/Order');
const User = require('../models/User');
const Cart = require('../models/Cart');
const Collection = require('../models/Collection');
const Coupon = require('../models/Coupon');
const Offer = require('../models/Offer');
const StockAdjustment = require('../models/StockAdjustment');
const StoreSettings = require('../models/StoreSettings');
const { asyncHandler, slugifyName, escapeRegex, cleanBody } = require('../utils/asyncHandler');

const PAID = ['paid', 'processing', 'packed', 'shipped', 'delivered'];

function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function rangeStart(range) {
  const now = new Date();
  if (range === 'today') return startOfDay(now);
  const days = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 }[range] || 30;
  return new Date(now.getTime() - days * 86400000);
}

function daysBetween(from, to) {
  const days = [];
  const cursor = startOfDay(from);
  const end = startOfDay(to);
  while (cursor <= end) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

exports.dashboard = asyncHandler(async (req, res) => {
  const range = req.query.range || '30d';
  const from = rangeStart(range);
  const today = startOfDay();
  const paidMatch = { status: { $in: PAID } };

  const [
    salesTodayAgg,
    ordersToday,
    customersToday,
    rangeSalesAgg,
    rangeOrders,
    pending,
    processing,
    lowStock,
    outOfStock,
    users,
    products,
    beads,
    paidInRange,
    lowStockProducts,
    outStockProducts,
    pendingOrders,
    missingImages,
    abandonedCarts,
  ] = await Promise.all([
    Order.aggregate([
      { $match: { ...paidMatch, createdAt: { $gte: today } } },
      { $group: { _id: null, total: { $sum: '$total' }, count: { $sum: 1 } } },
    ]),
    Order.countDocuments({ createdAt: { $gte: today } }),
    User.countDocuments({ role: 'customer', createdAt: { $gte: today } }),
    Order.aggregate([
      { $match: { ...paidMatch, createdAt: { $gte: from } } },
      { $group: { _id: null, total: { $sum: '$total' }, count: { $sum: 1 } } },
    ]),
    Order.countDocuments({ createdAt: { $gte: from } }),
    Order.countDocuments({ status: 'pending_payment' }),
    Order.countDocuments({ status: { $in: ['paid', 'processing', 'packed'] } }),
    Product.countDocuments({
      $expr: { $and: [{ $gt: ['$stock', 0] }, { $lte: ['$stock', { $ifNull: ['$lowStockLimit', 5] }] }] },
    }),
    Product.countDocuments({ stock: { $lte: 0 } }),
    User.countDocuments({ role: 'customer' }),
    Product.countDocuments(),
    Bead.countDocuments(),
    Order.find({ ...paidMatch, createdAt: { $gte: from } })
      .select('createdAt total items')
      .lean(),
    Product.find({
      $expr: { $and: [{ $gt: ['$stock', 0] }, { $lte: ['$stock', { $ifNull: ['$lowStockLimit', 5] }] }] },
    })
      .select('name sku stock lowStockLimit images')
      .limit(8)
      .lean(),
    Product.find({ stock: { $lte: 0 } }).select('name sku stock images').limit(8).lean(),
    Order.find({ status: 'pending_payment' })
      .select('orderNumber contactName total createdAt')
      .sort({ createdAt: -1 })
      .limit(8)
      .lean(),
    Product.find({ $or: [{ images: { $exists: false } }, { images: { $size: 0 } }] })
      .select('name sku')
      .limit(8)
      .lean(),
    Cart.countDocuments({ 'items.0': { $exists: true }, updatedAt: { $lt: new Date(Date.now() - 3600000) } }),
  ]);

  const todaySales = salesTodayAgg[0]?.total || 0;
  const todayPaidCount = salesTodayAgg[0]?.count || 0;
  const rangeSales = rangeSalesAgg[0]?.total || 0;
  const rangePaidCount = rangeSalesAgg[0]?.count || 0;
  const aov = rangePaidCount ? Math.round(rangeSales / rangePaidCount) : 0;

  const byDay = new Map();
  for (const d of daysBetween(from, new Date())) {
    byDay.set(d.toISOString().slice(0, 10), { date: d.toISOString().slice(0, 10), sales: 0, orders: 0 });
  }
  for (const o of paidInRange) {
    const key = new Date(o.createdAt).toISOString().slice(0, 10);
    const row = byDay.get(key);
    if (!row) continue;
    row.sales += o.total || 0;
    row.orders += 1;
  }

  const productSales = new Map();
  for (const o of paidInRange) {
    for (const item of o.items || []) {
      const name = item.snapshot?.name || item.name || 'Custom bracelet';
      const qty = item.quantity || 1;
      const revenue = item.lineTotal || 0;
      const prev = productSales.get(name) || { name, qty: 0, revenue: 0 };
      prev.qty += qty;
      prev.revenue += revenue;
      productSales.set(name, prev);
    }
  }
  const topProducts = [...productSales.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 8);

  res.json({
    range,
    kpis: {
      salesToday: todaySales,
      ordersToday,
      customersToday,
      aov,
      pending,
      processing,
      lowStock,
      outOfStock,
      salesRange: rangeSales,
      ordersRange: rangeOrders,
      paidToday: todayPaidCount,
    },
    counts: { users, products, beads },
    salesSeries: [...byDay.values()],
    topProducts,
    actions: {
      lowStock: lowStockProducts,
      outOfStock: outStockProducts,
      pendingOrders,
      missingImages,
      abandonedCarts,
    },
  });
});

exports.customers = asyncHandler(async (req, res) => {
  const group = req.query.group || 'all';
  const q = String(req.query.q || '').trim();
  const filter = { role: 'customer' };
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ name: rx }, { email: rx }, { phone: rx }];
  }
  const users = await User.find(filter).select('-passwordHash').sort({ createdAt: -1 }).lean();
  const stats = await Order.aggregate([
    { $match: { userId: { $ne: null } } },
    {
      $group: {
        _id: '$userId',
        orders: { $sum: 1 },
        spent: { $sum: '$total' },
        lastOrder: { $max: '$createdAt' },
      },
    },
  ]);
  const byUser = new Map(stats.map((s) => [String(s._id), s]));
  const now = Date.now();
  const day = 86400000;
  let customers = users.map((u) => {
    const s = byUser.get(String(u._id));
    const orders = s?.orders || 0;
    const spent = s?.spent || 0;
    const lastOrder = s?.lastOrder || null;
    let segment = 'new';
    if (orders > 1) segment = 'repeat';
    if (spent >= 5000) segment = 'vip';
    if (!lastOrder && now - new Date(u.createdAt).getTime() > 30 * day) segment = 'inactive';
    if (lastOrder && now - new Date(lastOrder).getTime() > 90 * day) segment = 'inactive';
    return { ...u, orders, spent, lastOrder, segment };
  });
  if (group === 'new') customers = customers.filter((c) => now - new Date(c.createdAt).getTime() <= 30 * day);
  if (group === 'repeat') customers = customers.filter((c) => c.orders > 1);
  if (group === 'vip') customers = customers.filter((c) => c.spent >= 5000);
  if (group === 'inactive') customers = customers.filter((c) => c.segment === 'inactive');
  res.json({ customers });
});

exports.abandonedCarts = asyncHandler(async (_req, res) => {
  const carts = await Cart.find({ 'items.0': { $exists: true } })
    .populate('userId', 'name email phone')
    .sort({ updatedAt: -1 })
    .lean();
  const cutoff = Date.now() - 3600000;
  const rows = carts
    .filter((c) => new Date(c.updatedAt).getTime() < cutoff)
    .map((c) => ({
      _id: c._id,
      user: c.userId,
      items: c.items.length,
      total: c.items.reduce((s, i) => s + (i.lineTotal || 0), 0),
      updatedAt: c.updatedAt,
    }));
  res.json({ carts: rows });
});

function couponStatus(c, now = new Date()) {
  if (!c.isActive) return 'inactive';
  if (c.startsAt && new Date(c.startsAt) > now) return 'scheduled';
  if (c.endsAt && new Date(c.endsAt) < now) return 'expired';
  return 'active';
}

exports.listCollections = asyncHandler(async (_req, res) => {
  const collections = await Collection.find().sort({ sortOrder: 1, name: 1 }).lean();
  res.json({ collections });
});

exports.saveCollection = asyncHandler(async (req, res) => {
  const data = cleanBody(req.body);
  if (!data.slug && data.name) data.slug = slugifyName(data.name);
  const collection = req.params.id
    ? await Collection.findByIdAndUpdate(req.params.id, data, { new: true })
    : await Collection.create(data);
  if (!collection) return res.status(404).json({ message: 'Collection not found.' });
  res.json({ collection });
});

exports.removeCollection = asyncHandler(async (req, res) => {
  await Collection.findByIdAndDelete(req.params.id);
  await Product.updateMany({ collectionIds: req.params.id }, { $pull: { collectionIds: req.params.id } });
  res.json({ ok: true });
});

exports.listCoupons = asyncHandler(async (_req, res) => {
  const coupons = await Coupon.find().sort({ createdAt: -1 }).lean();
  res.json({ coupons: coupons.map((c) => ({ ...c, status: couponStatus(c) })) });
});

exports.saveCoupon = asyncHandler(async (req, res) => {
  const data = cleanBody(req.body);
  delete data.status;
  if (data.code) data.code = String(data.code).toUpperCase().trim();
  const coupon = req.params.id
    ? await Coupon.findByIdAndUpdate(req.params.id, data, { new: true })
    : await Coupon.create(data);
  if (!coupon) return res.status(404).json({ message: 'Coupon not found.' });
  res.json({ coupon });
});

exports.removeCoupon = asyncHandler(async (req, res) => {
  await Coupon.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

exports.listOffers = asyncHandler(async (_req, res) => {
  const offers = await Offer.find().populate('categoryId', 'name').sort({ createdAt: -1 }).lean();
  res.json({ offers });
});

exports.saveOffer = asyncHandler(async (req, res) => {
  const data = cleanBody(req.body);
  if (!data.categoryId) data.categoryId = undefined;
  const offer = req.params.id
    ? await Offer.findByIdAndUpdate(req.params.id, data, { new: true })
    : await Offer.create(data);
  if (!offer) return res.status(404).json({ message: 'Offer not found.' });
  res.json({ offer });
});

exports.removeOffer = asyncHandler(async (req, res) => {
  await Offer.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

exports.inventory = asyncHandler(async (req, res) => {
  const view = req.query.view || 'all';
  const q = String(req.query.q || '').trim();
  const filter = {};
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ name: rx }, { sku: rx }];
  }
  const products = await Product.find(filter).populate('categoryId', 'name').sort({ name: 1 }).lean();
  const tagged = products.map((p) => {
    const limit = p.lowStockLimit ?? 5;
    let stockStatus = 'ok';
    if (p.stock <= 0) stockStatus = 'out';
    else if (p.stock <= limit) stockStatus = 'low';
    return { ...p, stockStatus, lowStockLimit: limit };
  });
  const rows =
    view === 'low' ? tagged.filter((p) => p.stockStatus === 'low') :
    view === 'out' ? tagged.filter((p) => p.stockStatus === 'out') :
    tagged;
  res.json({ products: rows });
});

exports.adjustStock = asyncHandler(async (req, res) => {
  const { productId, delta, reason } = req.body;
  const amount = Number(delta);
  if (!productId || !Number.isFinite(amount) || amount === 0) {
    return res.status(400).json({ message: 'A product and a non-zero quantity are required.' });
  }
  if (!reason || !String(reason).trim()) {
    return res.status(400).json({ message: 'A reason is required.' });
  }
  const product = await Product.findById(productId);
  if (!product) return res.status(404).json({ message: 'Product not found.' });
  const previousStock = product.stock || 0;
  const nextStock = Math.max(0, previousStock + amount);
  product.stock = nextStock;
  await product.save();
  const adjustment = await StockAdjustment.create({
    productId,
    delta: amount,
    reason: String(reason).trim(),
    previousStock,
    nextStock,
    userId: req.user?._id,
  });
  res.status(201).json({ product, adjustment });
});

exports.stockHistory = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.productId) filter.productId = req.query.productId;
  const history = await StockAdjustment.find(filter)
    .populate('productId', 'name sku')
    .populate('userId', 'name email')
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();
  res.json({ history });
});

const SETTINGS_DEFAULTS = {
  key: 'store',
  storeName: 'Kuberstones',
  logo: '',
  email: 'hello@kuberstones.com',
  phone: '',
  currency: 'INR',
  payment: { cod: false, upi: false, gateway: '' },
  shipping: { fee: 0, freeThreshold: 999 },
  tax: { gstPercent: 0 },
  notifications: { email: true, sms: false, whatsapp: false },
};

exports.getSettings = asyncHandler(async (_req, res) => {
  let settings = await StoreSettings.findOne({ key: 'store' }).lean();
  if (!settings) settings = SETTINGS_DEFAULTS;
  res.json({ settings: { ...SETTINGS_DEFAULTS, ...settings } });
});

exports.saveSettings = asyncHandler(async (req, res) => {
  const incoming = cleanBody(req.body);
  const settings = await StoreSettings.findOneAndUpdate(
    { key: 'store' },
    { $set: { ...incoming, key: 'store' } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();
  res.json({ settings });
});
