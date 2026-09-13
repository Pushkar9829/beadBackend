const Product = require('../models/Product');
const Category = require('../models/Category');
const Collection = require('../models/Collection');
const { asyncHandler, slugifyName, cleanBody } = require('../utils/asyncHandler');
const { parsePage, pageMeta, parseSort } = require('../utils/pagination');
const { getSalePriceMap, applySaleToProduct } = require('../services/flashSaleService');
const { productsForCollection } = require('../services/collectionService');

function asAttributes(value) {
  if (!value) return {};
  if (value instanceof Map) return Object.fromEntries(value);
  if (typeof value.toObject === 'function') return value.toObject();
  return { ...value };
}

function withPublicFields(product, saleMap) {
  const next = applySaleToProduct(product, saleMap);
  return { ...next, attributes: asAttributes(next.attributes) };
}

exports.listPublic = asyncHandler(async (req, res) => {
  const filter = { isActive: true };
  if (req.query.family) filter.family = req.query.family;
  if (req.query.featured === 'true') filter.featured = true;
  if (req.query.category) {
    const cat = await Category.findOne({ slug: req.query.category });
    if (cat) {
      const children = await Category.find({ parentId: cat._id }).select('_id');
      const ids = [cat._id, ...children.map((c) => c._id)];
      filter.categoryId = { $in: ids };
    }
  }
  const saleMap = await getSalePriceMap();
  if (req.query.collection) {
    const collection = await Collection.findOne({ slug: req.query.collection, isActive: true }).lean();
    if (collection) {
      const all = (await productsForCollection(collection, filter.family ? { family: filter.family } : {})).map((p) =>
        withPublicFields(p, saleMap)
      );
      if (req.query.page) {
        const { page, limit, skip } = parsePage(req, 24);
        return res.json({
          products: all.slice(skip, skip + limit),
          collection,
          pagination: pageMeta(all.length, page, limit),
        });
      }
      return res.json({ products: all, collection });
    }
  }
  const sort = req.query.featured === 'true' ? { featuredSort: 1, createdAt: -1 } : { createdAt: -1 };
  if (req.query.page) {
    const { page, limit, skip } = parsePage(req, 24);
    const [rows, total] = await Promise.all([
      Product.find(filter).populate('categoryId', 'name slug family').sort(sort).skip(skip).limit(limit).lean(),
      Product.countDocuments(filter),
    ]);
    return res.json({
      products: rows.map((p) => withPublicFields(p, saleMap)),
      pagination: pageMeta(total, page, limit),
    });
  }
  const products = (await Product.find(filter).populate('categoryId', 'name slug family').sort(sort).lean()).map((p) =>
    withPublicFields(p, saleMap)
  );
  res.json({ products });
});

exports.getBySlug = asyncHandler(async (req, res) => {
  const product = await Product.findOne({ slug: req.params.slug, isActive: true })
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

exports.adminList = asyncHandler(async (req, res) => {
  const sort = parseSort(req, ['createdAt', 'name', 'price', 'stock'], '-createdAt');
  const filter = {};
  if (req.query.q) {
    const { escapeRegex } = require('../utils/asyncHandler');
    const rx = new RegExp(escapeRegex(req.query.q), 'i');
    filter.$or = [{ name: rx }, { sku: rx }];
  }
  if (req.query.family && req.query.family !== 'all') filter.family = req.query.family;
  const query = Product.find(filter)
    .populate('categoryId', 'name slug')
    .populate('collectionIds', 'name slug')
    .sort(sort);
  if (req.query.page) {
    const { page, limit, skip } = parsePage(req, 50);
    const [rows, total] = await Promise.all([query.skip(skip).limit(limit).lean(), Product.countDocuments(filter)]);
    return res.json({
      products: rows.map((p) => ({ ...p, attributes: asAttributes(p.attributes) })),
      pagination: pageMeta(total, page, limit),
    });
  }
  const products = (await query.lean()).map((p) => ({ ...p, attributes: asAttributes(p.attributes) }));
  res.json({ products, pagination: pageMeta(products.length, 1, products.length || 1) });
});

exports.adminCreate = asyncHandler(async (req, res) => {
  const data = cleanBody(req.body);
  if (!data.slug && data.name) data.slug = slugifyName(data.name);
  if (!data.sku) data.sku = makeSku(data.name);
  const product = await Product.create(data);
  res.status(201).json({ product });
});

exports.adminUpdate = asyncHandler(async (req, res) => {
  const product = await Product.findByIdAndUpdate(req.params.id, cleanBody(req.body), { new: true });
  if (!product) return res.status(404).json({ message: 'Product not found.' });
  res.json({ product });
});

exports.adminRemove = asyncHandler(async (req, res) => {
  await Product.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});
