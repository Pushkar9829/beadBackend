const Product = require('../models/Product');
const Category = require('../models/Category');
const Collection = require('../models/Collection');
const mongoose = require('mongoose');
const {
  asyncHandler,
  slugifyName,
  cleanBody,
  toStr,
  escapeRegex,
  UPDATE_OPTS,
  mergeNestedKeys,
  takeNullsAsUnset,
  buildUpdate,
} = require('../utils/asyncHandler');
const { parsePage, pageMeta, parseSort } = require('../utils/pagination');
const { getSalePriceMap, applySaleToProduct } = require('../services/flashSaleService');
const { productsForCollection } = require('../services/collectionService');
const { attachProductRating } = require('../lib/productRating');

const MAX_SLUGS = 24;

function asAttributes(value) {
  if (!value) return {};
  if (value instanceof Map) return Object.fromEntries(value);
  if (typeof value.toObject === 'function') return value.toObject();
  return { ...value };
}

function withPublicFields(product, saleMap) {
  const next = applySaleToProduct(product, saleMap);
  return attachProductRating({ ...next, attributes: asAttributes(next.attributes) });
}

exports.listPublic = asyncHandler(async (req, res) => {
  const filter = { isActive: true };
  const family = toStr(req.query.family, 40);
  const categorySlug = toStr(req.query.category, 120);
  const collectionSlug = toStr(req.query.collection, 120);
  if (family) filter.family = family;
  if (req.query.featured === 'true') filter.featured = true;
  // slugs=a,b,c: resolve specific active products (e.g. home hotspots / shop-the-look points).
  if (req.query.slugs !== undefined) {
    const rawSlugs = (Array.isArray(req.query.slugs) ? req.query.slugs.map((v) => toStr(v, 200)).join(',') : toStr(req.query.slugs, 24 * 200)).split(',');
    const slugs = [...new Set(rawSlugs.map((s) => s.trim().toLowerCase()).filter(Boolean))].slice(0, MAX_SLUGS);
    filter.slug = { $in: slugs };
  }
  if (categorySlug) {
    const cat = await Category.findOne({ slug: categorySlug });
    if (cat) {
      const children = await Category.find({ parentId: cat._id }).select('_id');
      const ids = [cat._id, ...children.map((c) => c._id)];
      filter.categoryId = { $in: ids };
    }
  }
  // Always paginated: callers without ?page get the first page with a generous default limit.
  const { page, limit, skip } = parsePage(req, req.query.page ? 24 : 500, 500);
  const saleMap = await getSalePriceMap();
  if (collectionSlug) {
    const collection = await Collection.findOne({ slug: collectionSlug, isActive: true })
      .select('name slug description image sortOrder ruleType ruleConfig')
      .lean();
    if (collection) {
      const all = (await productsForCollection(collection, filter.family ? { family: filter.family } : {})).map((p) =>
        withPublicFields(p, saleMap)
      );
      const { ruleConfig, ...publicCollection } = collection;
      return res.json({
        products: all.slice(skip, skip + limit),
        collection: publicCollection,
        pagination: pageMeta(all.length, page, limit),
      });
    }
  }
  const sort = req.query.featured === 'true' ? { featuredSort: 1, createdAt: -1 } : { createdAt: -1 };
  const [rows, total] = await Promise.all([
    Product.find(filter).populate('categoryId', 'name slug family').sort(sort).skip(skip).limit(limit).lean(),
    Product.countDocuments(filter),
  ]);
  res.json({
    products: rows.map((p) => withPublicFields(p, saleMap)),
    pagination: pageMeta(total, page, limit),
  });
});

exports.getBySlug = asyncHandler(async (req, res) => {
  const product = await Product.findOne({ slug: toStr(req.params.slug, 200), isActive: true })
    .populate('categoryId', 'name slug family seo')
    .populate('collectionIds', 'name slug')
    .lean();
  if (!product) return res.status(404).json({ message: 'Product not found.' });
  const saleMap = await getSalePriceMap();
  res.json({ product: withPublicFields(product, saleMap) });
});

function makeSku(name) {
  const base = slugifyName(name || 'item').replace(/-/g, '').slice(0, 8).toUpperCase() || 'ITEM';
  return `KS-${base}-${Date.now().toString(36).slice(-4).toUpperCase()}`;
}

const PRODUCT_NULLABLE = ['compareAtPrice', 'sku'];
const MAX_IDS = 100;

exports.adminList = asyncHandler(async (req, res) => {
  const sort = parseSort(req, ['createdAt', 'name', 'price', 'stock'], '-createdAt');
  const filter = {};
  // ids=<id,id,...>: resolve specific products (e.g. a picker's current selection). Invalid ids are ignored.
  if (req.query.ids !== undefined) {
    const rawIds = (Array.isArray(req.query.ids) ? req.query.ids.join(',') : toStr(req.query.ids, 100 * 30)).split(',');
    const ids = [...new Set(rawIds.map((id) => id.trim()).filter((id) => mongoose.isValidObjectId(id)))].slice(0, MAX_IDS);
    filter._id = { $in: ids };
  }
  const q = toStr(req.query.q, 100);
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ name: rx }, { sku: rx }];
  }
  const status = toStr(req.query.status, 20);
  if (status === 'active') filter.isActive = true;
  else if (status === 'inactive') filter.isActive = false;
  const family = toStr(req.query.family, 40);
  if (family && family !== 'all') filter.family = family;
  const categoryId = toStr(req.query.categoryId, 40);
  if (categoryId && categoryId !== 'all') {
    if (!mongoose.isValidObjectId(categoryId)) return res.status(400).json({ message: 'Invalid category id.' });
    filter.categoryId = categoryId;
  }
  const stock = toStr(req.query.stock, 10);
  if (stock === 'out') filter.stock = { $lte: 0 };
  else if (stock === 'low') {
    filter.$expr = { $and: [{ $gt: ['$stock', 0] }, { $lte: ['$stock', { $ifNull: ['$lowStockLimit', 5] }] }] };
  }
  if (req.query.featured === 'true') filter.featured = true;
  else if (req.query.featured === 'false') filter.featured = { $ne: true };

  const { page, limit, skip } = parsePage(req, 25, 100);
  const sortSpec = sort.startsWith('-') ? { [sort.slice(1)]: -1, _id: -1 } : { [sort]: 1, _id: 1 };
  const [rows, total] = await Promise.all([
    Product.find(filter)
      .populate('categoryId', 'name slug')
      .populate('collectionIds', 'name slug')
      .sort(sortSpec)
      .skip(skip)
      .limit(limit)
      .lean(),
    Product.countDocuments(filter),
  ]);
  res.json({
    products: rows.map((p) => ({ ...p, attributes: asAttributes(p.attributes) })),
    pagination: pageMeta(total, page, limit),
  });
});

exports.adminGetOne = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Product not found.' });
  const product = await Product.findById(req.params.id)
    .populate('categoryId', 'name slug')
    .populate('collectionIds', 'name slug')
    .lean();
  if (!product) return res.status(404).json({ message: 'Product not found.' });
  res.json({ product: { ...product, attributes: asAttributes(product.attributes) } });
});

exports.adminCreate = asyncHandler(async (req, res) => {
  const data = cleanBody(req.body);
  takeNullsAsUnset(data, PRODUCT_NULLABLE); // nothing to unset on create; just drop the nulls
  if (!data.slug && data.name) data.slug = slugifyName(data.name);
  if (!data.sku) data.sku = makeSku(toStr(data.name));
  const product = await Product.create(data);
  res.status(201).json({ product });
});

exports.adminUpdate = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Product not found.' });
  const data = cleanBody(req.body);
  const $unset = takeNullsAsUnset(data, PRODUCT_NULLABLE);
  const update = buildUpdate(mergeNestedKeys(data, ['seo']), $unset);
  const product = await Product.findByIdAndUpdate(req.params.id, update, UPDATE_OPTS);
  if (!product) return res.status(404).json({ message: 'Product not found.' });
  res.json({ product });
});

exports.adminRemove = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Product not found.' });
  const product = await Product.findByIdAndDelete(req.params.id);
  if (!product) return res.status(404).json({ message: 'Product not found.' });
  res.json({ ok: true });
});

