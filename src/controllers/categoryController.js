const Category = require('../models/Category');
const { asyncHandler, slugifyName, cleanBody, toStr, UPDATE_OPTS } = require('../utils/asyncHandler');

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

exports.adminCreate = asyncHandler(async (req, res) => {
  const body = cleanBody(req.body);
  const { parentId, image, description, sortOrder, isActive } = body;
  const name = toStr(body.name, 120);
  const family = toStr(body.family, 40);
  if (!name || !family) return res.status(400).json({ message: 'Name and family are required.' });
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
  });
  res.status(201).json({ category });
});

exports.adminUpdate = asyncHandler(async (req, res) => {
  const data = cleanBody(req.body);
  if (data.parentId !== undefined && data.parentId && String(data.parentId) === String(req.params.id)) {
    return res.status(400).json({ message: 'A category cannot be its own parent.' });
  }
  if (data.parentId === '') data.parentId = null;
  const category = await Category.findByIdAndUpdate(req.params.id, { $set: data }, UPDATE_OPTS);
  if (!category) return res.status(404).json({ message: 'Category not found.' });
  res.json({ category });
});

exports.adminRemove = asyncHandler(async (req, res) => {
  await Category.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});
