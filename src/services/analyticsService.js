const Order = require('../models/Order');
const User = require('../models/User');
const Product = require('../models/Product');
const Coupon = require('../models/Coupon');
const Cart = require('../models/Cart');
const Category = require('../models/Category');

const PAID = ['paid', 'processing', 'packed', 'shipped', 'delivered'];

const DAY_MS = 86400000;
const MAX_RANGE_DAYS = 366;

function rangeError(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function parseDateParam(value) {
  if (value == null || typeof value === 'object') return null;
  const raw = String(value).trim();
  if (!raw || raw.length > 40) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Resolves a reporting window from ?range= or ?from=&to=.
 * Invalid dates throw a 400; custom ranges are clamped to MAX_RANGE_DAYS (ending at `to`).
 */
function parseRange(query = {}) {
  const now = new Date();
  if (query.from || query.to) {
    const from = parseDateParam(query.from);
    const to = parseDateParam(query.to);
    if (!from || !to) throw rangeError('Provide valid "from" and "to" dates (YYYY-MM-DD).');
    to.setHours(23, 59, 59, 999);
    if (from > to) throw rangeError('"from" must be on or before "to".');
    let clampedFrom = from;
    if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY_MS) {
      clampedFrom = new Date(to.getTime() - MAX_RANGE_DAYS * DAY_MS);
    }
    return { from: clampedFrom, to, range: 'custom', clamped: clampedFrom !== from };
  }
  const range = typeof query.range === 'string' ? query.range : '30d';
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (range === 'today') return { from: start, to: now, range };
  const known = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 };
  const days = known[range] || 30;
  return { from: new Date(now.getTime() - days * DAY_MS), to: now, range: known[range] ? range : '30d' };
}

/** Neutralises spreadsheet formula injection (=, +, -, @, tab, CR) in CSV cells. */
function csvCell(val) {
  if (val == null) return '';
  let s = val instanceof Date ? val.toISOString() : String(val);
  if (typeof val !== 'number' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows, columns) {
  const header = columns.map((c) => csvCell(c.label)).join(',');
  const lines = rows.map((row) => columns.map((c) => csvCell(c.value(row))).join(','));
  return [header, ...lines].join('\n');
}

async function buildReport({ from, to }) {
  const paidMatch = { status: { $in: PAID }, createdAt: { $gte: from, $lte: to } };
  const [orders, customers, allCustomers, abandoned, categories] = await Promise.all([
    Order.find(paidMatch).select('total items createdAt').lean(),
    User.countDocuments({ role: 'customer', createdAt: { $gte: from, $lte: to } }),
    User.countDocuments({ role: 'customer' }),
    Cart.countDocuments({ 'items.0': { $exists: true }, updatedAt: { $lt: new Date(Date.now() - 3600000) } }),
    Category.find().select('name').lean(),
  ]);
  const allOrders = await Order.countDocuments({ createdAt: { $gte: from, $lte: to } });
  const revenue = orders.reduce((s, o) => s + (o.total || 0), 0);
  const aov = orders.length ? Math.round(revenue / orders.length) : 0;
  const conversionRate = allOrders + abandoned ? Math.round((orders.length / (allOrders + abandoned)) * 1000) / 10 : 0;

  const productMap = new Map();
  const categoryRev = new Map();
  for (const o of orders) {
    for (const item of o.items || []) {
      const name = item.snapshot?.name || item.name || 'Custom bracelet';
      const cat = String(item.snapshot?.categoryId || item.categoryId || '');
      const qty = item.quantity || 1;
      const rev = item.lineTotal || 0;
      const prev = productMap.get(name) || { name, qty: 0, revenue: 0, orders: 0 };
      prev.qty += qty;
      prev.revenue += rev;
      prev.orders += 1;
      productMap.set(name, prev);
      if (cat) {
        const cprev = categoryRev.get(cat) || { categoryId: cat, revenue: 0, qty: 0 };
        cprev.revenue += rev;
        cprev.qty += qty;
        categoryRev.set(cat, cprev);
      }
    }
  }
  const ranked = [...productMap.values()].sort((a, b) => b.revenue - a.revenue);
  const catNames = Object.fromEntries(categories.map((c) => [String(c._id), c.name]));
  const byCategory = [...categoryRev.values()]
    .map((c) => ({ ...c, name: catNames[c.categoryId] || 'Uncategorised' }))
    .sort((a, b) => b.revenue - a.revenue);

  const spenders = await Order.aggregate([
    { $match: { userId: { $ne: null }, status: { $in: PAID } } },
    { $group: { _id: '$userId', n: { $sum: 1 } } },
  ]);
  const withOrders = spenders.length;
  const repeat = spenders.filter((s) => s.n > 1).length;
  const repeatRate = withOrders ? Math.round((repeat / withOrders) * 1000) / 10 : 0;

  const coupons = await Coupon.find().sort({ revenueGenerated: -1 }).lean();

  return {
    from,
    to,
    kpis: {
      revenue,
      orders: orders.length,
      customers,
      allCustomers,
      aov,
      conversionRate,
      repeatRate,
      abandoned,
    },
    bestSellers: ranked.slice(0, 10),
    worstSellers: ranked.slice(-10).reverse(),
    categories: byCategory,
    coupons: coupons.map((c) => ({
      code: c.code,
      usedCount: c.usedCount || 0,
      revenueGenerated: c.revenueGenerated || 0,
      discountCost: c.discountCost || 0,
    })),
  };
}

module.exports = { parseRange, toCsv, csvCell, buildReport, PAID, MAX_RANGE_DAYS };
