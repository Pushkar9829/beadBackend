const Product = require('../models/Product');
const Category = require('../models/Category');
const { asyncHandler, slugifyName } = require('../utils/asyncHandler');

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
  const products = await Product.find(filter).populate('categoryId', 'name slug family').sort({ createdAt: -1 }).lean();
  res.json({ products });
});

exports.getBySlug = asyncHandler(async (req, res) => {
  const product = await Product.findOne({ slug: req.params.slug, isActive: true })
    .populate('categoryId', 'name slug family')
    .lean();
  if (!product) return res.status(404).json({ message: 'Product not found.' });
  res.json({ product });
});

exports.adminList = asyncHandler(async (_req, res) => {
  const products = await Product.find().populate('categoryId', 'name slug').sort({ createdAt: -1 }).lean();
  res.json({ products });
});

exports.adminCreate = asyncHandler(async (req, res) => {
  const data = { ...req.body };
  if (!data.slug && data.name) data.slug = slugifyName(data.name);
  const product = await Product.create(data);
  res.status(201).json({ product });
});

exports.adminUpdate = asyncHandler(async (req, res) => {
  const product = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!product) return res.status(404).json({ message: 'Product not found.' });
  res.json({ product });
});

exports.adminRemove = asyncHandler(async (req, res) => {
  await Product.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});
