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
const mongoose = require('mongoose');
const {
  asyncHandler,
  slugifyName,
  escapeRegex,
  cleanBody,
  toStr,
  UPDATE_OPTS,
  isPlainObject,
  flattenForSet,
  mergeNestedKeys,
  takeNullsAsUnset,
  buildUpdate,
} = require('../utils/asyncHandler');
const { parsePage, pageMeta, parseSort } = require('../utils/pagination');
const { parseRange, toCsv } = require('../services/analyticsService');

function notFoundIfBadId(req, res, label) {
  if (mongoose.isValidObjectId(req.params.id)) return false;
  res.status(404).json({ message: `${label} not found.` });
  return true;
}

function numOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function dateOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? 'invalid' : d;
}

/** Validates a start/end window on the effective (stored + incoming) values. Returns an error message or null. */
function windowError(effective) {
  const startsAt = dateOrNull(effective.startsAt);
  const endsAt = dateOrNull(effective.endsAt);
  if (startsAt === 'invalid' || endsAt === 'invalid') return 'Invalid start or end date.';
  if (startsAt && endsAt && endsAt <= startsAt) return 'The end date must be after the start date.';
  return null;
}

/** Stored values merged with the incoming update (unset keys removed) for cross-field validation. */
function effectiveValues(existing, data, $unset) {
  const out = { ...(existing || {}), ...data };
  for (const key of Object.keys($unset)) delete out[key];
  return out;
}

const PAID = ['paid', 'processing', 'packed', 'shipped', 'delivered'];

function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
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
  // Validates from/to (400 on invalid) and clamps custom ranges to 366 days.
  const { from, to, range } = parseRange(req.query);
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
    range,
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

const DAY_MS = 86400000;

// Orders that count toward spent / aov / orderCount: paid, or in fulfilment. Never cancelled or unpaid-pending.
const COUNTED_ORDER_MATCH = {
  status: { $nin: ['cancelled', 'pending_payment'] },
  $or: [{ 'payment.status': 'paid' }, { status: { $in: ['processing', 'packed', 'shipped', 'delivered'] } }],
};
const CUSTOMER_EXPORT_CAP = 10000;

function customerSegment(u, s, now) {
  const orders = s?.orders || 0;
  const spent = s?.spent || 0;
  const lastOrder = s?.lastOrder || null;
  let segment = 'new';
  if (orders > 1) segment = 'repeat';
  if (spent >= 5000) segment = 'vip';
  if (!lastOrder && now - new Date(u.createdAt).getTime() > 30 * DAY_MS) segment = 'inactive';
  if (lastOrder && now - new Date(lastOrder).getTime() > 90 * DAY_MS) segment = 'inactive';
  return {
    ...u,
    isActive: u.isActive !== false,
    orders,
    orderCount: orders,
    spent,
    aov: orders ? Math.round(spent / orders) : 0,
    lastOrder,
    segment,
  };
}

/** Lists customers for the given query (group, q) and window. Returns { customers, total }. */
async function findCustomers(query, { skip, limit }) {
  const group = toStr(query.group, 20) || 'all';
  const q = toStr(query.q, 100);
  const now = Date.now();
  const filter = { role: 'customer' };
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ name: rx }, { email: rx }, { phone: rx }];
  }
  if (group === 'new') filter.createdAt = { $gte: new Date(now - 30 * DAY_MS) };

  let users;
  let total;
  let statsById;
  if (['repeat', 'vip', 'inactive'].includes(group)) {
    // Segment filters depend on order stats, so compute them per user inside the DB.
    const segmentMatch = {
      repeat: { 'stats.orders': { $gt: 1 } },
      vip: { 'stats.spent': { $gte: 5000 } },
      inactive: {
        $or: [
          { 'stats.lastOrder': null, createdAt: { $lt: new Date(now - 30 * DAY_MS) } },
          { 'stats.lastOrder': { $lt: new Date(now - 90 * DAY_MS) } },
        ],
      },
    }[group];
    const [result] = await User.aggregate([
      { $match: filter },
      { $project: { passwordHash: 0, tokenVersion: 0 } },
      {
        $lookup: {
          from: Order.collection.name,
          let: { uid: '$_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$userId', '$$uid'] } } },
            { $match: COUNTED_ORDER_MATCH },
            { $group: { _id: null, orders: { $sum: 1 }, spent: { $sum: '$total' }, lastOrder: { $max: '$createdAt' } } },
          ],
          as: 'statsArr',
        },
      },
      {
        $addFields: {
          stats: {
            $ifNull: [{ $arrayElemAt: ['$statsArr', 0] }, { orders: 0, spent: 0, lastOrder: null }],
          },
        },
      },
      { $match: segmentMatch },
      { $sort: { createdAt: -1, _id: -1 } },
      {
        $facet: {
          rows: [{ $skip: skip }, { $limit: limit }, { $project: { statsArr: 0 } }],
          total: [{ $count: 'n' }],
        },
      },
    ]);
    const rows = result?.rows || [];
    total = result?.total?.[0]?.n || 0;
    statsById = new Map(rows.map((r) => [String(r._id), r.stats]));
    users = rows.map(({ stats, ...u }) => u);
  } else {
    [users, total] = await Promise.all([
      User.find(filter).select('-passwordHash -tokenVersion').sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
      User.countDocuments(filter),
    ]);
    const stats = users.length
      ? await Order.aggregate([
          { $match: { userId: { $in: users.map((u) => u._id) }, ...COUNTED_ORDER_MATCH } },
          { $group: { _id: '$userId', orders: { $sum: 1 }, spent: { $sum: '$total' }, lastOrder: { $max: '$createdAt' } } },
        ])
      : [];
    statsById = new Map(stats.map((st) => [String(st._id), st]));
  }
  return { customers: users.map((u) => customerSegment(u, statsById.get(String(u._id)), now)), total };
}

exports.customers = asyncHandler(async (req, res) => {
  // Unpaginated callers (current admin UI) get a generous but bounded list.
  const { page, limit, skip } = parsePage(req, req.query.page ? 100 : 2000, 2000);
  const { customers, total } = await findCustomers(req.query, { skip, limit });
  res.json({ customers, pagination: pageMeta(total, page, limit) });
});

exports.exportCustomers = asyncHandler(async (req, res) => {
  const { customers } = await findCustomers(req.query, { skip: 0, limit: CUSTOMER_EXPORT_CAP });
  const iso = (d) => (d ? new Date(d).toISOString() : '');
  const csv = toCsv(customers, [
    { label: 'name', value: (c) => c.name || '' },
    { label: 'email', value: (c) => c.email || '' },
    { label: 'phone', value: (c) => c.phone || '' },
    { label: 'segment', value: (c) => c.segment },
    { label: 'orders', value: (c) => c.orderCount },
    { label: 'spent', value: (c) => c.spent },
    { label: 'aov', value: (c) => c.aov },
    { label: 'lastOrder', value: (c) => iso(c.lastOrder) },
    { label: 'joined', value: (c) => iso(c.createdAt) },
  ]);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="customers.csv"');
  res.send(csv);
});

const ABANDONED_ITEMS_CAP = 20;

function cartItemRow(item) {
  const snap = item?.snapshot || {};
  const name = snap.name || (item?.kind === 'custom_bracelet' ? snap.title || 'Custom bracelet' : 'Product');
  const image = snap.image || (Array.isArray(snap.images) ? snap.images[0] : '') || snap.previewImage || '';
  return {
    name,
    quantity: item?.quantity || 1,
    unitPrice: item?.unitPrice || 0,
    lineTotal: item?.lineTotal || 0,
    image: image || null,
  };
}

exports.abandonedCarts = asyncHandler(async (req, res) => {
  // Unpaginated callers (current admin UI) get a generous but bounded list.
  const { page, limit, skip } = parsePage(req, req.query.page ? 100 : 2000, 2000);
  const filter = { 'items.0': { $exists: true }, updatedAt: { $lt: new Date(Date.now() - 3600000) } };
  const [carts, total] = await Promise.all([
    Cart.find(filter).populate('userId', 'name email phone').sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
    Cart.countDocuments(filter),
  ]);
  const rows = carts.map((c) => ({
    _id: c._id,
    user: c.userId,
    items: c.items.slice(0, ABANDONED_ITEMS_CAP).map(cartItemRow),
    itemCount: c.items.length,
    total: c.items.reduce((sum, i) => sum + (i.lineTotal || 0), 0),
    updatedAt: c.updatedAt,
    remindedAt: c.remindedAt,
  }));
  res.json({ carts: rows, pagination: pageMeta(total, page, limit) });
});

function couponStatus(c, now = new Date()) {
  if (!c.isActive) return 'inactive';
  if (c.startsAt && new Date(c.startsAt) > now) return 'scheduled';
  if (c.endsAt && new Date(c.endsAt) < now) return 'expired';
  return 'active';
}

exports.listCollections = asyncHandler(async (_req, res) => {
  // Default collections are seeded at startup (collectionService.ensureDefaultCollections), not on read.
  const collections = await Collection.find().sort({ sortOrder: 1, name: 1 }).lean();
  res.json({ collections });
});

exports.saveCollection = asyncHandler(async (req, res) => {
  if (req.params.id && notFoundIfBadId(req, res, 'Collection')) return;
  const data = cleanBody(req.body);
  if (!data.slug && data.name) data.slug = slugifyName(data.name);
  if (isPlainObject(data.ruleConfig) && data.ruleConfig.limit != null) {
    data.ruleConfig.limit = Math.min(100, Math.max(1, Math.floor(Number(data.ruleConfig.limit)) || 24));
  }
  // Updates merge seo / ruleConfig into the stored sub-objects instead of replacing them.
  const collection = req.params.id
    ? await Collection.findByIdAndUpdate(req.params.id, { $set: mergeNestedKeys(data, ['seo', 'ruleConfig']) }, UPDATE_OPTS)
    : await Collection.create(data);
  if (!collection) return res.status(404).json({ message: 'Collection not found.' });
  res.json({ collection });
});

exports.removeCollection = asyncHandler(async (req, res) => {
  if (notFoundIfBadId(req, res, 'Collection')) return;
  const removed = await Collection.findByIdAndDelete(req.params.id);
  if (!removed) return res.status(404).json({ message: 'Collection not found.' });
  await Product.updateMany({ collectionIds: req.params.id }, { $pull: { collectionIds: req.params.id } });
  res.json({ ok: true });
});

exports.listCoupons = asyncHandler(async (_req, res) => {
  const coupons = await Coupon.find().sort({ createdAt: -1 }).limit(2000).lean();
  res.json({ coupons: coupons.map((c) => ({ ...c, status: couponStatus(c) })) });
});

const COUPON_NULLABLE = ['maxDiscount', 'usageLimit', 'startsAt', 'endsAt'];

function couponError(c) {
  const value = numOrNull(c.value);
  const minOrder = numOrNull(c.minOrder);
  const usageLimit = numOrNull(c.usageLimit);
  const maxDiscount = numOrNull(c.maxDiscount);
  if (Number.isNaN(value) || Number.isNaN(minOrder) || Number.isNaN(usageLimit) || Number.isNaN(maxDiscount)) {
    return 'Coupon amounts must be numbers.';
  }
  if (value != null && value < 0) return 'Coupon value cannot be negative.';
  if (c.type === 'percent' && value != null && value > 100) return 'A percent coupon cannot exceed 100%.';
  if (minOrder != null && minOrder < 0) return 'Minimum order cannot be negative.';
  if (usageLimit != null && usageLimit < 1) return 'Usage limit must be at least 1 when set.';
  if (maxDiscount != null && maxDiscount < 0) return 'Maximum discount cannot be negative.';
  return windowError(c);
}

exports.saveCoupon = asyncHandler(async (req, res) => {
  if (req.params.id && notFoundIfBadId(req, res, 'Coupon')) return;
  const data = cleanBody(req.body, { omit: ['status', 'usedCount', 'revenueGenerated', 'discountCost'] });
  if (data.code !== undefined) data.code = toStr(data.code, 40).toUpperCase();
  const $unset = takeNullsAsUnset(data, COUPON_NULLABLE);
  const existing = req.params.id ? await Coupon.findById(req.params.id).lean() : null;
  if (req.params.id && !existing) return res.status(404).json({ message: 'Coupon not found.' });
  const error = couponError(effectiveValues(existing, data, $unset));
  if (error) return res.status(400).json({ message: error });
  const coupon = req.params.id
    ? await Coupon.findByIdAndUpdate(req.params.id, buildUpdate(data, $unset), UPDATE_OPTS)
    : await Coupon.create(data);
  if (!coupon) return res.status(404).json({ message: 'Coupon not found.' });
  res.json({ coupon });
});

exports.removeCoupon = asyncHandler(async (req, res) => {
  if (notFoundIfBadId(req, res, 'Coupon')) return;
  const removed = await Coupon.findByIdAndDelete(req.params.id);
  if (!removed) return res.status(404).json({ message: 'Coupon not found.' });
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
  const offers = await Offer.find().populate('categoryId', 'name').sort({ createdAt: -1 }).limit(2000).lean();
  res.json({ offers });
});

const OFFER_NULLABLE = ['startsAt', 'endsAt', 'percent', 'buyQty', 'getQty', 'minOrder', 'amountOff'];

function offerError(o) {
  const nums = Object.fromEntries(['percent', 'buyQty', 'getQty', 'minOrder', 'amountOff'].map((k) => [k, numOrNull(o[k])]));
  if (Object.values(nums).some(Number.isNaN)) return 'Offer amounts must be numbers.';
  if (nums.percent != null && (nums.percent < 0 || nums.percent > 100)) return 'Percent must be between 0 and 100.';
  if (nums.minOrder != null && nums.minOrder < 0) return 'Minimum order cannot be negative.';
  if (nums.amountOff != null && nums.amountOff < 0) return 'Amount off cannot be negative.';
  if (o.type === 'bogo' && !(nums.buyQty >= 1 && nums.getQty >= 1)) {
    return 'Buy X get Y offers need a buy quantity and a get quantity of at least 1.';
  }
  return windowError(o);
}

exports.saveOffer = asyncHandler(async (req, res) => {
  if (req.params.id && notFoundIfBadId(req, res, 'Offer')) return;
  const data = cleanBody(req.body);
  const unset = takeNullsAsUnset(data, OFFER_NULLABLE);
  // Only clear the category when the client explicitly sends an empty one; a partial update
  // (e.g. toggling isActive) must not turn a category offer into a store-wide one.
  if ('categoryId' in data && !data.categoryId) {
    delete data.categoryId;
    if (req.params.id) unset.categoryId = 1;
  }
  const existing = req.params.id ? await Offer.findById(req.params.id).lean() : null;
  if (req.params.id && !existing) return res.status(404).json({ message: 'Offer not found.' });
  const error = offerError(effectiveValues(existing, data, unset));
  if (error) return res.status(400).json({ message: error });
  const offer = req.params.id
    ? await Offer.findByIdAndUpdate(req.params.id, buildUpdate(data, unset), UPDATE_OPTS)
    : await Offer.create(data);
  if (!offer) return res.status(404).json({ message: 'Offer not found.' });
  res.json({ offer });
});

exports.removeOffer = asyncHandler(async (req, res) => {
  if (notFoundIfBadId(req, res, 'Offer')) return;
  const removed = await Offer.findByIdAndDelete(req.params.id);
  if (!removed) return res.status(404).json({ message: 'Offer not found.' });
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
  const view = toStr(req.query.view, 10) || 'all';
  const kind = req.query.kind === 'bead' ? 'bead' : 'product';
  const q = toStr(req.query.q, 100);
  const { page, limit, skip } = parsePage(req, 50);
  const defaultLimit = kind === 'bead' ? 10 : 5;
  const filter = {};
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = kind === 'bead' ? [{ name: rx }, { slug: rx }] : [{ name: rx }, { sku: rx }];
  }
  if (req.query.categoryId && mongoose.isValidObjectId(req.query.categoryId)) filter.categoryId = req.query.categoryId;
  if (view === 'out') filter.stock = { $lte: 0 };
  if (view === 'low') {
    filter.$expr = {
      $and: [{ $gt: ['$stock', 0] }, { $lte: ['$stock', { $ifNull: ['$lowStockLimit', defaultLimit] }] }],
    };
  }
  const Model = kind === 'bead' ? Bead : Product;
  const sort = parseSort(req, ['name', 'stock', 'updatedAt', 'createdAt'], 'name');
  let query = Model.find(filter).sort(sort).skip(skip).limit(limit);
  if (kind === 'product') query = query.populate('categoryId', 'name');
  const [rows, total] = await Promise.all([query.lean(), Model.countDocuments(filter)]);
  const sliced = rows.map((r) => tagStock(r, defaultLimit));
  res.json({ products: sliced, items: sliced, kind, pagination: pageMeta(total, page, limit) });
});

exports.adjustStock = asyncHandler(async (req, res) => {
  const { productId, beadId, delta, reason } = req.body || {};
  const amount = typeof delta === 'number' || typeof delta === 'string' ? Number(delta) : NaN;
  const kind = beadId && !productId ? 'bead' : 'product';
  const id = kind === 'bead' ? beadId : productId;
  if (!id || !mongoose.isValidObjectId(id) || !Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 1000000) {
    return res.status(400).json({ message: 'A product or bead and a non-zero whole-number quantity are required.' });
  }
  const reasonText = toStr(reason, 500);
  if (!reasonText) {
    return res.status(400).json({ message: 'A reason is required.' });
  }
  const Model = kind === 'bead' ? Bead : Product;
  // Atomic, clamped at zero: stock = max(0, stock + amount). Returns the pre-update document.
  const before = await Model.findOneAndUpdate(
    { _id: id },
    [{ $set: { stock: { $max: [0, { $add: [{ $ifNull: ['$stock', 0] }, amount] }] } } }],
    { returnDocument: 'before', updatePipeline: true }
  ).lean();
  if (!before) return res.status(404).json({ message: kind === 'bead' ? 'Bead not found.' : 'Product not found.' });
  const previousStock = before.stock || 0;
  const nextStock = Math.max(0, previousStock + amount);
  const doc = { ...before, stock: nextStock };
  const adjustment = await StockAdjustment.create({
    kind,
    productId: kind === 'product' ? id : undefined,
    beadId: kind === 'bead' ? id : undefined,
    delta: amount,
    reason: reasonText,
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
  if (req.query.productId && mongoose.isValidObjectId(req.query.productId)) filter.productId = req.query.productId;
  if (req.query.beadId && mongoose.isValidObjectId(req.query.beadId)) filter.beadId = req.query.beadId;
  if (req.query.kind === 'product' || req.query.kind === 'bead') filter.kind = req.query.kind;
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

// Credential / integration fields. Only role 'admin' may change these; secrets are never returned.
const SECRET_FIELDS = {
  payment: ['cashfreeSecret'],
  shipping: ['ithinkSecretKey', 'ithinkWebhookSecret', 'ithinkAccessToken'],
};
const CREDENTIAL_FIELDS = {
  payment: ['cashfreeEnabled', 'cashfreeAppId', 'cashfreeSecret', 'cashfreeEnv', 'gatewayKeyId'],
  shipping: [
    'ithinkEnabled',
    'ithinkEnv',
    'ithinkAccessToken',
    'ithinkSecretKey',
    'ithinkPickupAddressId',
    'ithinkReturnAddressId',
    'ithinkLogistics',
    'ithinkServiceType',
    'ithinkWebhookSecret',
  ],
};
// Derived flags the UI may echo back; never persisted.
const DERIVED_FLAGS = {
  payment: ['cashfreeSecretSet'],
  shipping: ['ithinkSecretSet', 'ithinkWebhookSecretSet', 'ithinkAccessTokenSet', 'hasIthinkAccessToken'],
};

function mergeSettings(settings) {
  const src = settings || SETTINGS_DEFAULTS;
  return {
    ...SETTINGS_DEFAULTS,
    ...src,
    payment: { ...SETTINGS_DEFAULTS.payment, ...src.payment },
    shipping: { ...SETTINGS_DEFAULTS.shipping, ...src.shipping },
    tax: { ...SETTINGS_DEFAULTS.tax, ...src.tax },
    notifications: { ...SETTINGS_DEFAULTS.notifications, ...src.notifications },
    seo: { ...SETTINGS_DEFAULTS.seo, ...src.seo },
  };
}

/** Values shown in the admin form (env fallbacks applied) — secrets not yet masked. */
function displaySettings(stored) {
  const merged = mergeSettings(stored);
  merged.payment = {
    ...merged.payment,
    cashfreeAppId: merged.payment.cashfreeAppId || process.env.CASHFREE_APP_ID || '',
    cashfreeEnv: merged.payment.cashfreeEnv || process.env.CASHFREE_ENV || 'sandbox',
  };
  merged.shipping = {
    ...merged.shipping,
    ithinkEnv: merged.shipping.ithinkEnv || process.env.ITHINK_ENV || 'production',
    ithinkPickupAddressId: merged.shipping.ithinkPickupAddressId || process.env.ITHINK_PICKUP_ADDRESS_ID || '',
    ithinkReturnAddressId: merged.shipping.ithinkReturnAddressId || process.env.ITHINK_RETURN_ADDRESS_ID || '',
    ithinkLogistics: merged.shipping.ithinkLogistics || process.env.ITHINK_LOGISTICS || 'delhivery',
  };
  return merged;
}

/** Strips every secret from a settings object, replacing it with "is set" booleans. */
function maskSettings(settings) {
  const out = { ...settings, payment: { ...(settings.payment || {}) }, shipping: { ...(settings.shipping || {}) } };
  out.payment.cashfreeSecretSet = Boolean(out.payment.cashfreeSecret || process.env.CASHFREE_SECRET_KEY);
  out.payment.cashfreeSecret = '';
  out.shipping.ithinkSecretSet = Boolean(out.shipping.ithinkSecretKey || process.env.ITHINK_SECRET_KEY);
  out.shipping.ithinkWebhookSecretSet = Boolean(out.shipping.ithinkWebhookSecret || process.env.ITHINK_WEBHOOK_SECRET);
  const tokenSet = Boolean(out.shipping.ithinkAccessToken || process.env.ITHINK_ACCESS_TOKEN);
  out.shipping.ithinkAccessTokenSet = tokenSet;
  out.shipping.hasIthinkAccessToken = tokenSet;
  out.shipping.ithinkSecretKey = '';
  out.shipping.ithinkWebhookSecret = '';
  out.shipping.ithinkAccessToken = '';
  return out;
}

function isBlankOrMasked(value) {
  if (value == null) return true;
  if (typeof value !== 'string') return true;
  const v = value.trim();
  return !v || /^[*•●·xX]+$/.test(v) || /^\*{2,}.{0,6}$/.test(v);
}

exports.getSettings = asyncHandler(async (_req, res) => {
  const stored = await StoreSettings.findOne({ key: 'store' }).lean();
  res.json({ settings: maskSettings(displaySettings(stored)) });
});

exports.saveSettings = asyncHandler(async (req, res) => {
  const incoming = cleanBody(req.body);
  const current = await StoreSettings.findOne({ key: 'store' }).lean();
  const shown = displaySettings(current);
  const isAdmin = req.user?.role === 'admin';

  for (const section of ['payment', 'shipping']) {
    const sent = incoming[section] && typeof incoming[section] === 'object' && !Array.isArray(incoming[section])
      ? { ...incoming[section] }
      : {};
    for (const flag of DERIVED_FLAGS[section]) delete sent[flag];
    for (const field of CREDENTIAL_FIELDS[section]) {
      if (!(field in sent)) continue;
      const isSecret = SECRET_FIELDS[section].includes(field);
      if (isSecret) {
        // Never overwrite a stored secret with an empty / masked placeholder.
        if (isBlankOrMasked(sent[field])) {
          delete sent[field];
          continue;
        }
        sent[field] = String(sent[field]).trim().slice(0, 500);
        if (!isAdmin && sent[field] !== (current?.[section]?.[field] || '')) {
          return res.status(403).json({ message: 'Only administrators can change payment or shipping credentials.' });
        }
        continue;
      }
      const storedVal = current?.[section]?.[field];
      const shownVal = shown[section]?.[field];
      const unchanged = String(sent[field] ?? '') === String(storedVal ?? '')
        || String(sent[field] ?? '') === String(shownVal ?? '');
      if (unchanged) {
        // Echoed back from the form (possibly an env fallback) — keep what is stored.
        delete sent[field];
        continue;
      }
      if (!isAdmin) {
        return res.status(403).json({ message: 'Only administrators can change payment or shipping credentials.' });
      }
    }
    incoming[section] = sent;
  }

  // Sub-objects (payment, shipping, tax, seo, notifications, ...) merge into what is stored.
  delete incoming.key;
  const $set = { ...flattenForSet(incoming), key: 'store' };
  const settings = await StoreSettings.findOneAndUpdate(
    { key: 'store' },
    { $set },
    { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true, runValidators: true }
  ).lean();
  // Same shape as GET: defaults + env fallbacks, secrets masked.
  res.json({ settings: maskSettings(displaySettings(settings)) });
});
