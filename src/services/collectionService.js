const Collection = require('../models/Collection');
const Product = require('../models/Product');
const Order = require('../models/Order');

const PAID = ['paid', 'processing', 'packed', 'shipped', 'delivered'];

async function productsForCollection(collection, extraFilter = {}) {
  const limit = Math.min(100, Math.max(1, Math.floor(Number(collection.ruleConfig?.limit)) || 24));
  const filter = { isActive: true, ...extraFilter };
  const rule = collection.ruleType || 'manual';

  if (rule === 'manual') {
    return Product.find({ ...filter, collectionIds: collection._id })
      .populate('categoryId', 'name slug family')
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  }
  if (rule === 'featured') {
    return Product.find({ ...filter, featured: true })
      .populate('categoryId', 'name slug family')
      .sort({ featuredSort: 1, createdAt: -1 })
      .limit(limit)
      .lean();
  }
  if (rule === 'new_arrivals') {
    const days = collection.ruleConfig?.days || 30;
    const from = new Date(Date.now() - days * 86400000);
    return Product.find({ ...filter, createdAt: { $gte: from } })
      .populate('categoryId', 'name slug family')
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  }
  if (rule === 'under_price') {
    const maxPrice = collection.ruleConfig?.maxPrice || 999;
    return Product.find({ ...filter, price: { $lte: maxPrice } })
      .populate('categoryId', 'name slug family')
      .sort({ price: 1 })
      .limit(limit)
      .lean();
  }
  if (rule === 'bestsellers' || rule === 'trending') {
    const days = rule === 'trending' ? collection.ruleConfig?.days || 14 : collection.ruleConfig?.days || 90;
    const from = new Date(Date.now() - days * 86400000);
    const rows = await Order.aggregate([
      { $match: { status: { $in: PAID }, createdAt: { $gte: from } } },
      { $unwind: '$items' },
      { $match: { 'items.productId': { $ne: null } } },
      { $group: { _id: '$items.productId', qty: { $sum: '$items.quantity' } } },
      { $sort: { qty: -1 } },
      { $limit: limit },
    ]);
    const ids = rows.map((r) => r._id).filter(Boolean);
    if (!ids.length) {
      return Product.find(filter).populate('categoryId', 'name slug family').sort({ createdAt: -1 }).limit(limit).lean();
    }
    const products = await Product.find({ ...filter, _id: { $in: ids } })
      .populate('categoryId', 'name slug family')
      .lean();
    const order = new Map(ids.map((id, i) => [String(id), i]));
    return products.sort((a, b) => (order.get(String(a._id)) ?? 99) - (order.get(String(b._id)) ?? 99));
  }
  return [];
}

const DEFAULT_COLLECTIONS = [
  { name: 'Best Sellers', slug: 'best-sellers', ruleType: 'bestsellers', sortOrder: 1 },
  { name: 'New Arrivals', slug: 'new-arrivals', ruleType: 'new_arrivals', sortOrder: 2, ruleConfig: { days: 30, limit: 24 } },
  { name: 'Trending', slug: 'trending', ruleType: 'trending', sortOrder: 3, ruleConfig: { days: 14, limit: 24 } },
  { name: 'Under ₹999', slug: 'under-999', ruleType: 'under_price', sortOrder: 4, ruleConfig: { maxPrice: 999, limit: 24 } },
  { name: 'Premium Collection', slug: 'premium-collection', ruleType: 'manual', sortOrder: 5 },
  { name: 'Gift Collection', slug: 'gift-collection', ruleType: 'manual', sortOrder: 6 },
  { name: 'Healing Collection', slug: 'healing-collection', ruleType: 'manual', sortOrder: 7 },
];

/** Seeds the built-in collections if missing. Call once at startup, never from a request path. */
async function ensureDefaultCollections() {
  await Collection.bulkWrite(
    DEFAULT_COLLECTIONS.map((row) => ({
      updateOne: {
        filter: { slug: row.slug },
        update: { $setOnInsert: { ...row, isActive: true } },
        upsert: true,
      },
    })),
    { ordered: false }
  );
}

const PUBLIC_COLLECTION_FIELDS = 'name slug description image sortOrder ruleType';

async function listPublicCollections() {
  return Collection.find({ isActive: true }).select(PUBLIC_COLLECTION_FIELDS).sort({ sortOrder: 1, name: 1 }).limit(200).lean();
}

async function getBySlug(slug) {
  return Collection.findOne({ slug, isActive: true }).lean();
}

module.exports = { productsForCollection, listPublicCollections, getBySlug, ensureDefaultCollections };
