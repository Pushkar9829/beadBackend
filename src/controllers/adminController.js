const User = require('../models/User');
const SiteContent = require('../models/SiteContent');
const Media = require('../models/Media');
const { mergeHomeContent } = require('../data/homeContent');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { asyncHandler, toStr, cleanBody, escapeRegex, UPDATE_OPTS } = require('../utils/asyncHandler');
const { parsePage, pageMeta } = require('../utils/pagination');
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

const STAFF_ROLES = ['admin', 'manager', 'staff'];
const USER_ROLE_FILTERS = { staff: { $in: STAFF_ROLES }, admin: 'admin', manager: 'manager', customer: 'customer' };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MIN_STAFF_PASSWORD = 12;
const SAFE_USER_FIELDS = '-passwordHash -tokenVersion';

function publicUser(u) {
  if (!u) return u;
  const obj = typeof u.toObject === 'function' ? u.toObject() : { ...u };
  delete obj.passwordHash;
  delete obj.tokenVersion;
  return { ...obj, isActive: obj.isActive !== false, lastLoginAt: obj.lastLoginAt || null };
}

function readPassword(raw) {
  if (typeof raw !== 'string' || !raw) return { error: 'Password is required.' };
  if (raw.length < MIN_STAFF_PASSWORD || raw.length > 128) {
    return { error: `Password must be ${MIN_STAFF_PASSWORD}-128 characters.` };
  }
  return { password: raw };
}

async function activeAdminCount() {
  return User.countDocuments({ role: 'admin', isActive: { $ne: false } });
}

exports.users = asyncHandler(async (req, res) => {
  const role = toStr(req.query.role, 20) || 'staff';
  const filter = {};
  if (role !== 'all') {
    if (!USER_ROLE_FILTERS[role]) return res.status(400).json({ message: 'Invalid role filter.' });
    filter.role = USER_ROLE_FILTERS[role];
  }
  const q = toStr(req.query.q, 100);
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ name: rx }, { email: rx }];
  }
  const { page, limit, skip } = parsePage(req, 25, 100);
  const [rows, total] = await Promise.all([
    User.find(filter).select(SAFE_USER_FIELDS).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
    User.countDocuments(filter),
  ]);
  res.json({ users: rows.map(publicUser), pagination: pageMeta(total, page, limit) });
});

exports.createUser = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const name = toStr(body.name, 100);
  const email = toStr(body.email, 254).toLowerCase();
  const role = toStr(body.role, 20);
  if (!name) return res.status(400).json({ message: 'Name is required.' });
  if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ message: 'A valid email is required.' });
  if (!STAFF_ROLES.includes(role)) return res.status(400).json({ message: 'Role must be admin, manager or staff.' });
  const { password, error } = readPassword(body.password);
  if (error) return res.status(400).json({ message: error });
  if (await User.exists({ email })) return res.status(409).json({ message: 'An account with this email already exists.' });
  let user;
  try {
    user = await User.create({ name, email, role, passwordHash: await bcrypt.hash(password, 12), isActive: true });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: 'An account with this email already exists.' });
    throw err;
  }
  res.status(201).json({ user: publicUser(user) });
});

exports.setUserPassword = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'User not found.' });
  const { password, error } = readPassword(req.body?.password);
  if (error) return res.status(400).json({ message: error });
  const passwordHash = await bcrypt.hash(password, 12);
  // Bumping tokenVersion signs the user out everywhere.
  const result = await User.updateOne({ _id: req.params.id }, { $set: { passwordHash }, $inc: { tokenVersion: 1 } });
  if (!result.matchedCount) return res.status(404).json({ message: 'User not found.' });
  res.json({ ok: true });
});

exports.updateUser = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'User not found.' });
  const body = req.body || {};
  const target = await User.findById(req.params.id).select('role permissions isActive');
  if (!target) return res.status(404).json({ message: 'User not found.' });
  const actorIsAdmin = req.user?.role === 'admin';
  const isSelf = String(target._id) === String(req.user?._id);
  if (target.role === 'admin' && !actorIsAdmin) {
    return res.status(403).json({ message: 'Only administrators can edit administrator accounts.' });
  }

  const $set = {};
  if (body.name !== undefined) {
    const name = toStr(body.name, 100);
    if (!name) return res.status(400).json({ message: 'Name cannot be empty.' });
    $set.name = name;
  }
  if (body.phone !== undefined) $set.phone = toStr(body.phone, 20);

  let revokeTokens = false;
  const wantsRole = body.role !== undefined && body.role !== null && body.role !== '';
  const wantsPermissions = body.permissions !== undefined && body.permissions !== null;
  const wantsActive = body.isActive !== undefined && body.isActive !== null;
  const forbidPrivilege = () =>
    res.status(403).json({ message: 'Only administrators can change roles, permissions or account status.' });
  if (wantsRole) {
    const role = toStr(body.role, 20);
    if (!ROLES.includes(role)) return res.status(400).json({ message: 'Invalid role.' });
    if (role !== target.role) {
      if (!actorIsAdmin) return forbidPrivilege();
      if (isSelf) return res.status(403).json({ message: 'You cannot change your own role.' });
      if (target.role === 'admin' && target.isActive !== false && (await activeAdminCount()) <= 1) {
        return res.status(409).json({ message: 'Cannot demote the last remaining admin.' });
      }
      $set.role = role;
      revokeTokens = true;
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
      if (!actorIsAdmin) return forbidPrivilege();
      $set.permissions = permissions;
      revokeTokens = true;
    }
  }
  if (wantsActive) {
    if (typeof body.isActive !== 'boolean') return res.status(400).json({ message: 'isActive must be true or false.' });
    const currentActive = target.isActive !== false;
    if (body.isActive !== currentActive) {
      if (!actorIsAdmin) return forbidPrivilege();
      if (isSelf) return res.status(403).json({ message: 'You cannot deactivate your own account.' });
      if (!body.isActive && target.role === 'admin' && (await activeAdminCount()) <= 1) {
        return res.status(409).json({ message: 'Cannot deactivate the last active admin.' });
      }
      $set.isActive = body.isActive;
      if (!body.isActive) revokeTokens = true;
    }
  }

  const update = { $set };
  // Revoke existing JWTs when privileges change (or the account is disabled) so stale tokens cannot be reused.
  if (revokeTokens) update.$inc = { tokenVersion: 1 };
  const user = await User.findByIdAndUpdate(req.params.id, update, UPDATE_OPTS).select(SAFE_USER_FIELDS);
  if (!user) return res.status(404).json({ message: 'User not found.' });
  res.json({ user: publicUser(user) });
});

exports.content = asyncHandler(async (_req, res) => {
  const stored = await SiteContent.findOne({ key: 'main' }).lean();
  res.json({ content: mergeHomeContent(stored) });
});

exports.saveContent = asyncHandler(async (req, res) => {
  const incoming = cleanBody(req.body, { omit: ['key'] });
  // Top-level merge: only sections present in the body are replaced; other sections stay untouched,
  // so editors that save different sections cannot overwrite each other.
  const normalized = mergeHomeContent({ ...incoming, key: 'main' });
  const $set = { key: 'main' };
  for (const key of Object.keys(incoming)) {
    $set[key] = Object.prototype.hasOwnProperty.call(normalized, key) ? normalized[key] : incoming[key];
  }
  const content = await SiteContent.findOneAndUpdate(
    { key: 'main' },
    { $set },
    { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true, runValidators: true }
  ).lean();
  res.json({ content: mergeHomeContent(content) });
});

exports.listMedia = asyncHandler(async (req, res) => {
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
        ...(req.body?.folder !== undefined ? { folder: mediaFolder(req.body.folder) } : {}),
        // Tags are only replaced when the body includes them.
        ...(req.body?.tags !== undefined ? { tags: parseTags(req.body.tags) } : {}),
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
