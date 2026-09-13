const Order = require('../models/Order');
const User = require('../models/User');
const Product = require('../models/Product');
const Coupon = require('../models/Coupon');
const Cart = require('../models/Cart');
const Category = require('../models/Category');

const PAID = ['paid', 'processing', 'packed', 'shipped', 'delivered'];

function parseRange(query) {
  const now = new Date();
  if (query.from && query.to) {
    const from = new Date(query.from);
    const to = new Date(query.to);
    to.setHours(23, 59, 59, 999);
    return { from, to, range: 'custom' };
  }
  const range = query.range || '30d';
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (range === 'today') return { from: start, to: now, range };
  const days = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 }[range] || 30;
  return { from: new Date(now.getTime() - days * 86400000), to: now, range };
}

function toCsv(rows, columns) {
  const header = columns.map((c) => c.label).join(',');
  const lines = rows.map((row) =>
    columns
      .map((c) => {
        const val = c.value(row);
        const s = val == null ? '' : String(val);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      })
      .join(',')
  );
  return [header, ...lines].join('\n');
}

async function buildReport({ from, to }) {
  const paidMatch = { status: { $in: PAID }, createdAt: { $gte: from, $lte: to } };
  const [orders, customers, allCustomers, abandoned, categories] = await Promise.all([
    Order.find(paidMatch).lean(),
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

module.exports = { parseRange, toCsv, buildReport, PAID };
