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
  const { role, name, phone, permissions } = req.body;
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { role, name, phone, permissions },
    { new: true }
  ).select('-passwordHash');
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

exports.listMedia = asyncHandler(async (req, res) => {
  const { parsePage, pageMeta } = require('../utils/pagination');
  const { escapeRegex } = require('../utils/asyncHandler');
  const { page, limit, skip } = parsePage(req, 40);
  const filter = {};
  if (req.query.folder && req.query.folder !== 'all') filter.folder = req.query.folder;
  if (req.query.q) {
    const rx = new RegExp(escapeRegex(req.query.q), 'i');
    filter.$or = [{ originalName: rx }, { tags: rx }, { filename: rx }];
  }
  const [media, total] = await Promise.all([
    Media.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Media.countDocuments(filter),
  ]);
  res.json({ media, pagination: pageMeta(total, page, limit) });
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
    folder: req.body.folder || 'other',
    tags: req.body.tags ? String(req.body.tags).split(',').map((s) => s.trim()).filter(Boolean) : [],
  });
  res.status(201).json({ media });
});

exports.replaceMedia = asyncHandler(async (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const media = await Media.findById(req.params.id);
  if (!media) return res.status(404).json({ message: 'File not found.' });
  if (!req.file) return res.status(400).json({ message: 'No file uploaded.' });
  if (media.filename) {
    fs.unlink(path.join(__dirname, '../../uploads', media.filename), () => {});
  }
  media.filename = req.file.filename;
  media.originalName = req.file.originalname;
  media.url = `/uploads/${req.file.filename}`;
  media.mimeType = req.file.mimetype;
  media.size = req.file.size;
  if (req.body.folder) media.folder = req.body.folder;
  if (req.body.tags) media.tags = String(req.body.tags).split(',').map((s) => s.trim()).filter(Boolean);
  await media.save();
  res.json({ media });
});

exports.updateMedia = asyncHandler(async (req, res) => {
  const media = await Media.findByIdAndUpdate(
    req.params.id,
    {
      folder: req.body.folder,
      tags: Array.isArray(req.body.tags)
        ? req.body.tags
        : String(req.body.tags || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
    },
    { new: true }
  );
  if (!media) return res.status(404).json({ message: 'File not found.' });
  res.json({ media });
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
