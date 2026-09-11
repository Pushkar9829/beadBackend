const User = require('../models/User');
const SiteContent = require('../models/SiteContent');
const Media = require('../models/Media');
const { mergeHomeContent } = require('../data/homeContent');
const { asyncHandler } = require('../utils/asyncHandler');

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
  const stored = await SiteContent.findOne({ key: 'main' }).lean();
  res.json({ content: mergeHomeContent(stored) });
});

exports.saveContent = asyncHandler(async (req, res) => {
  const incoming = { ...req.body };
  delete incoming._id;
  delete incoming.__v;
  delete incoming.createdAt;
  delete incoming.updatedAt;
  const next = mergeHomeContent({ ...incoming, key: 'main' });
  delete next._id;
  delete next.createdAt;
  delete next.updatedAt;
  const content = await SiteContent.findOneAndUpdate(
    { key: 'main' },
    { $set: { ...next, key: 'main' } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();
  res.json({ content: mergeHomeContent(content) });
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

exports.deleteMedia = asyncHandler(async (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const media = await Media.findById(req.params.id);
  if (!media) return res.status(404).json({ message: 'File not found.' });
  if (media.filename) {
    const filePath = path.join(__dirname, '../../uploads', media.filename);
    fs.unlink(filePath, () => {});
  }
  await media.deleteOne();
  res.json({ ok: true });
});
