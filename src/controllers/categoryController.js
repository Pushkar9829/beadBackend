const Category = require('../models/Category');
const Product = require('../models/Product');
const mongoose = require('mongoose');
const { asyncHandler, slugifyName, cleanBody, toStr, UPDATE_OPTS, mergeNestedKeys } = require('../utils/asyncHandler');

const FAMILIES = ['crystals', 'rudraksha', 'gemstones', 'others'];

/** One slug or a list, kept in house order, with anything unknown dropped. */
function familiesFrom(value) {
  const raw = Array.isArray(value) ? value : value ? [value] : [];
  const picked = new Set(raw.map((item) => toStr(item, 40)).filter((slug) => FAMILIES.includes(slug)));
  return FAMILIES.filter((slug) => picked.has(slug));
}

/** A subcategory only sits under a parent that is in every selected family. */
async function parentFamilyError(parentId, family) {
  if (!parentId) return null;
  if (!mongoose.isValidObjectId(parentId)) return 'Parent category not found.';
  const parent = await Category.findById(parentId).select('family').lean();
  if (!parent) return 'Parent category not found.';
  const covered = familiesFrom(parent.family);
  if (!family.every((slug) => covered.includes(slug))) {
    return 'The parent must include every family selected for this category.';
  }
  return null;
}

function nestTree(categories) {
  const byId = Object.fromEntries(categories.map((c) => [String(c._id), { ...c, children: [] }]));
  const roots = [];
  categories.forEach((c) => {
    const node = byId[String(c._id)];
    if (c.parentId && byId[String(c.parentId)]) {
      byId[String(c.parentId)].children.push(node);
    } else {
      roots.push(node);
    }
  });
  const sortNodes = (nodes) => {
    nodes.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    nodes.forEach((n) => sortNodes(n.children));
  };
  sortNodes(roots);
  return roots;
}

exports.listPublic = asyncHandler(async (req, res) => {
  const filter = { isActive: true };
  const family = toStr(req.query.family, 40);
  if (family) filter.family = family;
  const categories = await Category.find(filter).sort({ sortOrder: 1, name: 1 }).lean();
  res.json({ categories, tree: nestTree(categories) });
});

exports.getBySlug = asyncHandler(async (req, res) => {
  const category = await Category.findOne({ slug: toStr(req.params.slug, 200), isActive: true }).lean();
  if (!category) return res.status(404).json({ message: 'Collection not found.' });
  const children = await Category.find({ parentId: category._id, isActive: true }).sort({ sortOrder: 1 }).lean();
  res.json({ category, children });
});

exports.adminList = asyncHandler(async (_req, res) => {
  const categories = await Category.find().sort({ family: 1, sortOrder: 1 }).lean();
  res.json({ categories, tree: nestTree(categories) });
});

exports.adminGetOne = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Category not found.' });
  const category = await Category.findById(req.params.id).lean();
  if (!category) return res.status(404).json({ message: 'Category not found.' });
  res.json({ category });
});

exports.adminCreate = asyncHandler(async (req, res) => {
  const body = cleanBody(req.body);
  const { parentId, image, description, sortOrder, isActive } = body;
  const name = toStr(body.name, 120);
  const family = familiesFrom(body.family);
  if (!name || !family.length) return res.status(400).json({ message: 'Name and at least one family are required.' });
  const parentError = await parentFamilyError(parentId, family);
  if (parentError) return res.status(400).json({ message: parentError });
  const slug = slugifyName(toStr(body.slug, 120) || name);
  const category = await Category.create({
    name,
    slug,
    family,
    parentId: parentId || null,
    image,
    description,
    sortOrder,
    isActive,
    ...(body.seo && typeof body.seo === 'object' ? { seo: body.seo } : {}),
  });
  res.status(201).json({ category });
});

exports.adminUpdate = asyncHandler(async (req, res) => {
  const data = cleanBody(req.body);
  if (data.parentId !== undefined && data.parentId && String(data.parentId) === String(req.params.id)) {
    return res.status(400).json({ message: 'A category cannot be its own parent.' });
  }
  if (data.parentId === '') data.parentId = null;
  if (data.family !== undefined) {
    data.family = familiesFrom(data.family);
    if (!data.family.length) return res.status(400).json({ message: 'Pick at least one family.' });
  }
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Category not found.' });
  if (data.parentId !== undefined || data.family !== undefined) {
    const current = await Category.findById(req.params.id).select('family parentId').lean();
    if (!current) return res.status(404).json({ message: 'Category not found.' });
    const nextFamily = data.family || familiesFrom(current.family);
    const nextParent = data.parentId !== undefined ? data.parentId : current.parentId;
    const parentError = await parentFamilyError(nextParent, nextFamily);
    if (parentError) return res.status(400).json({ message: parentError });
  }
  // seo merges into the stored sub-object instead of replacing it.
  const category = await Category.findByIdAndUpdate(req.params.id, { $set: mergeNestedKeys(data, ['seo']) }, UPDATE_OPTS);
  if (!category) return res.status(404).json({ message: 'Category not found.' });
  res.json({ category });
});

exports.adminRemove = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Category not found.' });
  const category = await Category.findByIdAndDelete(req.params.id);
  if (!category) return res.status(404).json({ message: 'Category not found.' });
  // Nothing may keep pointing at the deleted category: its products and subcategories move up to its
  // parent (or become uncategorised / top level).
  const parentId = category.parentId || null;
  const [products, children] = await Promise.all([
    Product.updateMany({ categoryId: category._id }, parentId ? { $set: { categoryId: parentId } } : { $unset: { categoryId: 1 } }),
    Category.updateMany({ parentId: category._id }, { $set: { parentId } }),
  ]);
  res.json({ ok: true, movedProducts: products.modifiedCount, movedSubcategories: children.modifiedCount });
});
