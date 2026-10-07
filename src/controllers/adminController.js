const User = require('../models/User');
const SiteContent = require('../models/SiteContent');
const Media = require('../models/Media');
const { mergeHomeContent } = require('../data/homeContent');
const mongoose = require('mongoose');
const { asyncHandler, toStr, cleanBody, UPDATE_OPTS } = require('../utils/asyncHandler');
const { putFile, deleteStored, safeOriginalName } = require('../lib/objectStorage');

const ROLES = ['customer', 'admin', 'manager', 'staff'];
const PERMISSION_RX = /^[a-z0-9_.:-]{1,64}$/i;

function parseTags(raw) {
  const list = Array.isArray(raw) ? raw : String(raw && typeof raw !== 'object' ? raw : '').split(',');
  return list
    .map((t) => toStr(t, 50))
    .filter(Boolean)
    .slice(0, 50);
}

function mediaFolder(raw) {
  const v = toStr(raw || 'other', 40).toLowerCase().replace(/[^a-z0-9_-]/g, '');
  return v && v !== 'all' ? v : 'other';
}

exports.users = asyncHandler(async (_req, res) => {
  const users = await User.find().select('-passwordHash -tokenVersion').sort({ createdAt: -1 }).lean();
  res.json({ users });
});

exports.updateUser = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'User not found.' });
  const body = req.body || {};
  const target = await User.findById(req.params.id).select('role permissions');
  if (!target) return res.status(404).json({ message: 'User not found.' });

  const $set = {};
  if (body.name !== undefined) {
    const name = toStr(body.name, 100);
    if (!name) return res.status(400).json({ message: 'Name cannot be empty.' });
    $set.name = name;
  }
  if (body.phone !== undefined) $set.phone = toStr(body.phone, 20);

  let privilegeChanged = false;
  const wantsRole = body.role !== undefined && body.role !== null && body.role !== '';
  const wantsPermissions = body.permissions !== undefined && body.permissions !== null;
  // Defense in depth: only full admins may change roles/permissions (route also enforces this).
  const forbidPrivilege = () => res.status(403).json({ message: 'Only administrators can change roles or permissions.' });
  if (wantsRole) {
    const role = toStr(body.role, 20);
    if (!ROLES.includes(role)) return res.status(400).json({ message: 'Invalid role.' });
    if (role !== target.role) {
      if (req.user?.role !== 'admin') return forbidPrivilege();
      if (String(target._id) === String(req.user?._id)) {
        return res.status(403).json({ message: 'You cannot change your own role.' });
      }
      if (target.role === 'admin') {
        const admins = await User.countDocuments({ role: 'admin' });
        if (admins <= 1) return res.status(409).json({ message: 'Cannot demote the last remaining admin.' });
      }
      $set.role = role;
      privilegeChanged = true;
    }
  }
  if (wantsPermissions) {
    if (!Array.isArray(body.permissions) || body.permissions.length > 100) {
      return res.status(400).json({ message: 'Permissions must be a list of up to 100 entries.' });
    }
    const permissions = [...new Set(body.permissions.map((p) => (typeof p === 'string' ? p.trim() : '')))];
    if (permissions.some((p) => !PERMISSION_RX.test(p))) {
      return res.status(400).json({ message: 'Each permission must be a short identifier (letters, digits, _ . : -).' });
    }
    const current = [...(target.permissions || [])].sort().join('|');
    if ([...permissions].sort().join('|') !== current) {
      if (req.user?.role !== 'admin') return forbidPrivilege();
      $set.permissions = permissions;
      privilegeChanged = true;
    }
  }

  const update = { $set };
  // Revoke existing JWTs when privileges change so stale role claims cannot be reused.
  if (privilegeChanged) update.$inc = { tokenVersion: 1 };
  const user = await User.findByIdAndUpdate(req.params.id, update, UPDATE_OPTS).select('-passwordHash -tokenVersion');
  if (!user) return res.status(404).json({ message: 'User not found.' });
  res.json({ user });
});

exports.content = asyncHandler(async (_req, res) => {
  const stored = await SiteContent.findOne({ key: 'main' }).lean();
  res.json({ content: mergeHomeContent(stored) });
});

exports.saveContent = asyncHandler(async (req, res) => {
  const incoming = cleanBody(req.body);
  const next = mergeHomeContent({ ...incoming, key: 'main' });
  delete next._id;
  delete next.createdAt;
  delete next.updatedAt;
  const content = await SiteContent.findOneAndUpdate(
    { key: 'main' },
    { $set: { ...next, key: 'main' } },
    { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true, runValidators: true }
  ).lean();
  res.json({ content: mergeHomeContent(content) });
});

exports.listMedia = asyncHandler(async (req, res) => {
  const { parsePage, pageMeta } = require('../utils/pagination');
  const { escapeRegex } = require('../utils/asyncHandler');
  const { page, limit, skip } = parsePage(req, 40);
  const filter = {};
  if (req.query.folder && req.query.folder !== 'all') filter.folder = mediaFolder(req.query.folder);
  const q = toStr(req.query.q, 100);
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
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
  const folder = mediaFolder(req.body.folder);
  const stored = await putFile(req.file, { folder });
  const media = await Media.create({
    filename: stored.filename,
    originalName: safeOriginalName(req.file.originalname),
    url: stored.url,
    key: stored.key,
    storage: stored.storage,
    mimeType: stored.mimeType,
    size: stored.size,
    folder,
    tags: req.body.tags ? parseTags(req.body.tags) : [],
  });
  res.status(201).json({ media });
});

exports.replaceMedia = asyncHandler(async (req, res) => {
  const media = await Media.findById(req.params.id);
  if (!media) return res.status(404).json({ message: 'File not found.' });
  if (!req.file) return res.status(400).json({ message: 'No file uploaded.' });
  const folder = mediaFolder(req.body.folder || media.folder);
  // Store the new file first so a rejected/failed upload does not destroy the existing one.
  const stored = await putFile(req.file, { folder });
  await deleteStored(media);
  media.filename = stored.filename;
  media.originalName = safeOriginalName(req.file.originalname);
  media.url = stored.url;
  media.key = stored.key;
  media.storage = stored.storage;
  media.mimeType = stored.mimeType;
  media.size = stored.size;
  media.folder = folder;
  if (req.body.tags) media.tags = parseTags(req.body.tags);
  await media.save();
  res.json({ media });
});

exports.updateMedia = asyncHandler(async (req, res) => {
  const media = await Media.findByIdAndUpdate(
    req.params.id,
    {
      $set: {
        ...(req.body.folder !== undefined ? { folder: mediaFolder(req.body.folder) } : {}),
        tags: parseTags(req.body.tags),
      },
    },
    UPDATE_OPTS
  );
  if (!media) return res.status(404).json({ message: 'File not found.' });
  res.json({ media });
});

exports.deleteMedia = asyncHandler(async (req, res) => {
  const media = await Media.findById(req.params.id);
  if (!media) return res.status(404).json({ message: 'File not found.' });
  await deleteStored(media);
  await media.deleteOne();
  res.json({ ok: true });
});
