const User = require('../models/User');
const Product = require('../models/Product');
const Bead = require('../models/Bead');
const Order = require('../models/Order');
const SiteContent = require('../models/SiteContent');
const Media = require('../models/Media');
const { asyncHandler } = require('../utils/asyncHandler');

exports.dashboard = asyncHandler(async (_req, res) => {
  const [users, products, beads, pendingOrders, lowStock] = await Promise.all([
    User.countDocuments(),
    Product.countDocuments(),
    Bead.countDocuments(),
    Order.countDocuments({ status: 'pending_payment' }),
    Product.countDocuments({ stock: { $lte: 5 } }),
  ]);
  res.json({ users, products, beads, pendingOrders, lowStock });
});

exports.users = asyncHandler(async (_req, res) => {
  const users = await User.find().select('-passwordHash').sort({ createdAt: -1 }).lean();
  res.json({ users });
});

exports.updateUser = asyncHandler(async (req, res) => {
  const { role, name, phone } = req.body;
  const user = await User.findByIdAndUpdate(req.params.id, { role, name, phone }, { new: true }).select('-passwordHash');
  if (!user) return res.status(404).json({ message: 'User not found.' });
  res.json({ user });
});

exports.content = asyncHandler(async (_req, res) => {
  const content = await SiteContent.findOne({ key: 'main' }).lean();
  res.json({ content });
});

exports.saveContent = asyncHandler(async (req, res) => {
  const content = await SiteContent.findOneAndUpdate({ key: 'main' }, { key: 'main', ...req.body }, { new: true, upsert: true });
  res.json({ content });
});

exports.listMedia = asyncHandler(async (_req, res) => {
  const media = await Media.find().sort({ createdAt: -1 }).lean();
  res.json({ media });
});

exports.uploadMedia = asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No file uploaded.' });
  const url = `/uploads/${req.file.filename}`;
  const media = await Media.create({
    filename: req.file.filename,
    originalName: req.file.originalname,
    url,
    mimeType: req.file.mimetype,
    size: req.file.size,
  });
  res.status(201).json({ media });
});
