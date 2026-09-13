const Wishlist = require('../models/Wishlist');
const Product = require('../models/Product');
const { asyncHandler } = require('../utils/asyncHandler');
const { getSalePriceMap, applySaleToProduct } = require('../services/flashSaleService');

async function getOrCreate(userId) {
  let doc = await Wishlist.findOne({ userId });
  if (!doc) doc = await Wishlist.create({ userId, items: [] });
  return doc;
}

exports.get = asyncHandler(async (req, res) => {
  const doc = await getOrCreate(req.user._id);
  const ids = doc.items.map((i) => i.productId);
  const saleMap = await getSalePriceMap();
  const products = await Product.find({ _id: { $in: ids }, isActive: true }).lean();
  const byId = Object.fromEntries(products.map((p) => [String(p._id), applySaleToProduct(p, saleMap)]));
  const items = doc.items.map((i) => byId[String(i.productId)]).filter(Boolean);
  res.json({ items });
});

exports.add = asyncHandler(async (req, res) => {
  const productId = req.body.productId;
  if (!productId) return res.status(400).json({ message: 'productId is required.' });
  const doc = await getOrCreate(req.user._id);
  if (!doc.items.some((i) => String(i.productId) === String(productId))) {
    doc.items.unshift({ productId });
    await doc.save();
  }
  const ids = doc.items.map((i) => i.productId);
  const products = await Product.find({ _id: { $in: ids }, isActive: true }).lean();
  res.json({ items: products });
});

exports.remove = asyncHandler(async (req, res) => {
  const doc = await getOrCreate(req.user._id);
  doc.items = doc.items.filter((i) => String(i.productId) !== String(req.params.productId));
  await doc.save();
  const ids = doc.items.map((i) => i.productId);
  const products = await Product.find({ _id: { $in: ids }, isActive: true }).lean();
  res.json({ items: products });
});

exports.merge = asyncHandler(async (req, res) => {
  const incoming = Array.isArray(req.body.productIds) ? req.body.productIds : [];
  const doc = await getOrCreate(req.user._id);
  const have = new Set(doc.items.map((i) => String(i.productId)));
  for (const id of incoming) {
    if (!have.has(String(id))) {
      doc.items.unshift({ productId: id });
      have.add(String(id));
    }
  }
  await doc.save();
  const products = await Product.find({ _id: { $in: doc.items.map((i) => i.productId) }, isActive: true }).lean();
  res.json({ items: products });
});
