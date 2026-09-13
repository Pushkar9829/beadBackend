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
  let from = rangeStart(range);
  let to = new Date();
  if (req.query.from && req.query.to) {
    from = new Date(req.query.from);
    to = new Date(req.query.to);
    to.setHours(23, 59, 59, 999);
  }
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
      { $match: { ...paidMatch, createdAt: { $gte: from, $lte: to } } },
      { $group: { _id: null, total: { $sum: '$total' }, count: { $sum: 1 } } },
    ]),
    Order.countDocuments({ createdAt: { $gte: from, $lte: to } }),
    Order.countDocuments({ status: 'pending_payment' }),
    Order.countDocuments({ status: { $in: ['paid', 'processing', 'packed'] } }),
    Product.countDocuments({
      $expr: { $and: [{ $gt: ['$stock', 0] }, { $lte: ['$stock', { $ifNull: ['$lowStockLimit', 5] }] }] },
    }),
    Product.countDocuments({ stock: { $lte: 0 } }),
    User.countDocuments({ role: 'customer' }),
    Product.countDocuments(),
    Bead.countDocuments(),
    Order.find({ ...paidMatch, createdAt: { $gte: from, $lte: to } })
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
  for (const d of daysBetween(from, to)) {
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
    range: req.query.from ? 'custom' : range,
    from,
    to,
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
    return { ...u, orders, spent, aov: orders ? Math.round(spent / orders) : 0, lastOrder, segment };
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
      remindedAt: c.remindedAt,
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
  const { ensureDefaultCollections } = require('../services/collectionService');
  await ensureDefaultCollections();
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

exports.couponUsage = asyncHandler(async (req, res) => {
  const CouponUsage = require('../models/CouponUsage');
  const history = await CouponUsage.find({ couponId: req.params.id })
    .populate('userId', 'name email')
    .populate('orderId', 'orderNumber total')
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();
  res.json({ history });
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

function tagStock(row, defaultLimit) {
  const limit = row.lowStockLimit ?? defaultLimit;
  let stockStatus = 'ok';
  if (row.stock <= 0) stockStatus = 'out';
  else if (row.stock <= limit) stockStatus = 'low';
  return { ...row, stockStatus, lowStockLimit: limit };
}

exports.inventory = asyncHandler(async (req, res) => {
  const view = req.query.view || 'all';
  const kind = req.query.kind || 'product';
  const q = String(req.query.q || '').trim();
  const { parsePage, pageMeta, parseSort } = require('../utils/pagination');
  const { page, limit, skip } = parsePage(req, 50);
  const filter = {};
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = kind === 'bead' ? [{ name: rx }, { slug: rx }] : [{ name: rx }, { sku: rx }];
  }
  if (req.query.categoryId) filter.categoryId = req.query.categoryId;
  const Model = kind === 'bead' ? Bead : Product;
  const sort = parseSort(req, ['name', 'stock', 'updatedAt', 'createdAt'], 'name');
  let query = Model.find(filter).sort(sort);
  if (kind === 'product') query = query.populate('categoryId', 'name');
  let rows = await query.lean();
  rows = rows.map((r) => tagStock(r, kind === 'bead' ? 10 : 5));
  if (view === 'low') rows = rows.filter((p) => p.stockStatus === 'low');
  if (view === 'out') rows = rows.filter((p) => p.stockStatus === 'out');
  const total = rows.length;
  const sliced = rows.slice(skip, skip + limit);
  res.json({ products: sliced, items: sliced, kind, pagination: pageMeta(total, page, limit) });
});

exports.adjustStock = asyncHandler(async (req, res) => {
  const { productId, beadId, delta, reason } = req.body;
  const amount = Number(delta);
  const kind = beadId && !productId ? 'bead' : 'product';
  if ((!productId && !beadId) || !Number.isFinite(amount) || amount === 0) {
    return res.status(400).json({ message: 'A product or bead and a non-zero quantity are required.' });
  }
  if (!reason || !String(reason).trim()) {
    return res.status(400).json({ message: 'A reason is required.' });
  }
  const doc = kind === 'bead' ? await Bead.findById(beadId) : await Product.findById(productId);
  if (!doc) return res.status(404).json({ message: kind === 'bead' ? 'Bead not found.' : 'Product not found.' });
  const previousStock = doc.stock || 0;
  const nextStock = Math.max(0, previousStock + amount);
  doc.stock = nextStock;
  await doc.save();
  const adjustment = await StockAdjustment.create({
    kind,
    productId: kind === 'product' ? productId : undefined,
    beadId: kind === 'bead' ? beadId : undefined,
    delta: amount,
    reason: String(reason).trim(),
    previousStock,
    nextStock,
    userId: req.user?._id,
  });
  const limit = doc.lowStockLimit ?? (kind === 'bead' ? 10 : 5);
  const { notify } = require('../services/notificationService');
  if (nextStock <= 0) {
    await notify({
      type: 'out_of_stock',
      title: `${doc.name} is out of stock`,
      body: `${kind === 'bead' ? 'Bead' : 'Product'} stock is 0 after an adjustment.`,
      link: '/admin/inventory',
    });
  } else if (nextStock <= limit && previousStock > limit) {
    await notify({
      type: 'low_stock',
      title: `${doc.name} is low on stock`,
      body: `Stock is ${nextStock} (alert at ${limit}).`,
      link: '/admin/inventory/low',
    });
  }
  res.status(201).json({ product: doc, item: doc, adjustment });
});

exports.stockHistory = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.productId) filter.productId = req.query.productId;
  if (req.query.beadId) filter.beadId = req.query.beadId;
  if (req.query.kind) filter.kind = req.query.kind;
  const history = await StockAdjustment.find(filter)
    .populate('productId', 'name sku')
    .populate('beadId', 'name slug')
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
  payment: {
    cod: true,
    upi: true,
    gateway: 'Cashfree',
    gatewayKeyId: '',
    upiId: '',
    cashfreeEnabled: true,
    cashfreeAppId: '',
    cashfreeSecret: '',
    cashfreeEnv: 'sandbox',
  },
  shipping: {
    fee: 0,
    freeThreshold: 999,
    estimatedDays: 5,
    ithinkEnabled: true,
    ithinkEnv: 'production',
    ithinkAccessToken: '',
    ithinkSecretKey: '',
    ithinkPickupAddressId: '',
    ithinkReturnAddressId: '',
    ithinkLogistics: 'delhivery',
    ithinkServiceType: '',
    ithinkWebhookSecret: '',
    defaultLengthCm: 10,
    defaultWidthCm: 10,
    defaultHeightCm: 5,
    defaultWeightGrams: 400,
  },
  tax: { gstPercent: 0 },
  notifications: { email: true, sms: false, whatsapp: false },
  seo: { title: 'Kuberstones', description: '', keywords: '', ogImage: '', noIndex: false },
};

exports.getSettings = asyncHandler(async (_req, res) => {
  let settings = await StoreSettings.findOne({ key: 'store' }).lean();
  if (!settings) settings = SETTINGS_DEFAULTS;
  const merged = {
    ...SETTINGS_DEFAULTS,
    ...settings,
    payment: { ...SETTINGS_DEFAULTS.payment, ...settings.payment },
    shipping: { ...SETTINGS_DEFAULTS.shipping, ...settings.shipping },
    tax: { ...SETTINGS_DEFAULTS.tax, ...settings.tax },
    notifications: { ...SETTINGS_DEFAULTS.notifications, ...settings.notifications },
    seo: { ...SETTINGS_DEFAULTS.seo, ...settings.seo },
  };
  const secretSet = Boolean(merged.payment.cashfreeSecret || process.env.CASHFREE_SECRET_KEY);
  merged.payment = {
    ...merged.payment,
    cashfreeSecret: '',
    cashfreeSecretSet: secretSet,
    cashfreeAppId: merged.payment.cashfreeAppId || process.env.CASHFREE_APP_ID || '',
    cashfreeEnv: merged.payment.cashfreeEnv || process.env.CASHFREE_ENV || 'sandbox',
  };
  const ithinkSecretSet = Boolean(merged.shipping.ithinkSecretKey || process.env.ITHINK_SECRET_KEY);
  const ithinkWebhookSecretSet = Boolean(merged.shipping.ithinkWebhookSecret || process.env.ITHINK_WEBHOOK_SECRET);
  merged.shipping = {
    ...merged.shipping,
    ithinkSecretKey: '',
    ithinkSecretSet,
    ithinkWebhookSecret: '',
    ithinkWebhookSecretSet,
    ithinkAccessToken: merged.shipping.ithinkAccessToken || process.env.ITHINK_ACCESS_TOKEN || '',
    ithinkEnv: merged.shipping.ithinkEnv || process.env.ITHINK_ENV || 'production',
    ithinkPickupAddressId: merged.shipping.ithinkPickupAddressId || process.env.ITHINK_PICKUP_ADDRESS_ID || '',
    ithinkReturnAddressId: merged.shipping.ithinkReturnAddressId || process.env.ITHINK_RETURN_ADDRESS_ID || '',
    ithinkLogistics: merged.shipping.ithinkLogistics || process.env.ITHINK_LOGISTICS || 'delhivery',
  };
  res.json({ settings: merged });
});

exports.saveSettings = asyncHandler(async (req, res) => {
  const incoming = cleanBody(req.body);
  const current = await StoreSettings.findOne({ key: 'store' }).lean();
  const payment = { ...(current?.payment || {}), ...(incoming.payment || {}) };
  if (!incoming.payment?.cashfreeSecret) {
    payment.cashfreeSecret = current?.payment?.cashfreeSecret || '';
  }
  delete payment.cashfreeSecretSet;
  incoming.payment = payment;
  const shipping = { ...(current?.shipping || {}), ...(incoming.shipping || {}) };
  if (!incoming.shipping?.ithinkSecretKey) {
    shipping.ithinkSecretKey = current?.shipping?.ithinkSecretKey || '';
  }
  if (!incoming.shipping?.ithinkWebhookSecret) {
    shipping.ithinkWebhookSecret = current?.shipping?.ithinkWebhookSecret || '';
  }
  delete shipping.ithinkSecretSet;
  delete shipping.ithinkWebhookSecretSet;
  incoming.shipping = shipping;
  const settings = await StoreSettings.findOneAndUpdate(
    { key: 'store' },
    { $set: { ...incoming, key: 'store' } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();
  const out = settings.toObject ? settings.toObject() : settings;
  if (out.payment) {
    out.payment.cashfreeSecretSet = Boolean(out.payment.cashfreeSecret || process.env.CASHFREE_SECRET_KEY);
    out.payment.cashfreeSecret = '';
  }
  if (out.shipping) {
    out.shipping.ithinkSecretSet = Boolean(out.shipping.ithinkSecretKey || process.env.ITHINK_SECRET_KEY);
    out.shipping.ithinkWebhookSecretSet = Boolean(out.shipping.ithinkWebhookSecret || process.env.ITHINK_WEBHOOK_SECRET);
    out.shipping.ithinkSecretKey = '';
    out.shipping.ithinkWebhookSecret = '';
  }
  res.json({ settings: out });
});
