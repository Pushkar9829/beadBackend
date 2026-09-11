const Category = require('../models/Category');
const { asyncHandler, slugifyName, cleanBody } = require('../utils/asyncHandler');

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
  if (req.query.family) filter.family = req.query.family;
  const categories = await Category.find(filter).sort({ sortOrder: 1, name: 1 }).lean();
  res.json({ categories, tree: nestTree(categories) });
});

exports.getBySlug = asyncHandler(async (req, res) => {
  const category = await Category.findOne({ slug: req.params.slug, isActive: true }).lean();
  if (!category) return res.status(404).json({ message: 'Collection not found.' });
  const children = await Category.find({ parentId: category._id, isActive: true }).sort({ sortOrder: 1 }).lean();
  res.json({ category, children });
});

exports.adminList = asyncHandler(async (_req, res) => {
  const categories = await Category.find().sort({ family: 1, sortOrder: 1 }).lean();
  res.json({ categories, tree: nestTree(categories) });
});

exports.adminCreate = asyncHandler(async (req, res) => {
  const { name, family, parentId, image, description, sortOrder, isActive } = req.body;
  if (!name || !family) return res.status(400).json({ message: 'Name and family are required.' });
  const slug = req.body.slug || slugifyName(name);
  const category = await Category.create({
    name,
    slug,
    family,
    parentId: parentId || null,
    image,
    description,
    sortOrder,
    isActive,
  });
  res.status(201).json({ category });
});

exports.adminUpdate = asyncHandler(async (req, res) => {
  const category = await Category.findByIdAndUpdate(req.params.id, cleanBody(req.body), { new: true });
  if (!category) return res.status(404).json({ message: 'Category not found.' });
  res.json({ category });
});

exports.adminRemove = asyncHandler(async (req, res) => {
  await Category.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});
