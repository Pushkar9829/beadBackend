const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Cart = require('../models/Cart');
const { asyncHandler } = require('../utils/asyncHandler');
const { signToken, setAuthCookie, clearAuthCookie } = require('../middleware/auth');

const DUMMY_HASH = bcrypt.hashSync('timing-equaliser-not-a-password', 12);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function str(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

exports.register = asyncHandler(async (req, res) => {
  const name = str(req.body.name, 100);
  const email = str(req.body.email, 254).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const phone = str(req.body.phone, 20);
  if (!name || !email || !password) {
    return res.status(400).json({ message: 'Name, email and password are required.' });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ message: 'Please enter a valid email address.' });
  }
  if (password.length < 8 || password.length > 128) {
    return res.status(400).json({ message: 'Password must be 8-128 characters.' });
  }
  const exists = await User.findOne({ email });
  if (exists) return res.status(409).json({ message: 'An account with this email already exists.' });

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.create({ name, email, passwordHash, phone });
  await Cart.create({ userId: user._id, items: [] });
  try {
    const { notify } = require('../services/notificationService');
    await notify({
      type: 'new_customer',
      title: `New customer ${user.name}`,
      body: user.email,
      link: '/admin/customers',
    });
  } catch {
    /* non-blocking */
  }
  const token = signToken(user);
  setAuthCookie(res, token);
  res.status(201).json({ user: user.toPublic(), token });
});

exports.login = asyncHandler(async (req, res) => {
  const email = str(req.body.email, 254).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password.slice(0, 128) : '';
  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required.' });
  }
  const user = await User.findOne({ email });
  // Compare against a dummy hash for unknown emails so response time doesn't reveal which accounts exist.
  const ok = await bcrypt.compare(password, user?.passwordHash || DUMMY_HASH);
  if (!user || !ok) return res.status(401).json({ message: 'Invalid email or password.' });
  if (user.isActive === false) return res.status(401).json({ message: 'This account is disabled.' });
  user.lastLoginAt = new Date();
  await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: user.lastLoginAt } });
  const token = signToken(user);
  setAuthCookie(res, token);
  res.json({ user: user.toPublic(), token });
});

exports.logout = asyncHandler(async (req, res) => {
  // Revoke every token issued so far for this user (tokens live in localStorage too).
  if (req.user) await User.updateOne({ _id: req.user._id }, { $inc: { tokenVersion: 1 } });
  clearAuthCookie(res);
  res.json({ ok: true });
});

exports.me = asyncHandler(async (req, res) => {
  if (!req.user) return res.json({ user: null, token: null });
  res.json({ user: req.user.toPublic() });
});

function sanitizeAddresses(list = []) {
  const cleaned = list
    .filter((raw) => raw && typeof raw === 'object')
    .map((raw) => ({
      ...(raw._id ? { _id: raw._id } : {}),
      label: String(raw.label || 'Home').trim().slice(0, 40) || 'Home',
      line1: String(raw.line1 || '').trim().slice(0, 200),
      line2: String(raw.line2 || '').trim().slice(0, 200),
      city: String(raw.city || '').trim().slice(0, 80),
      state: String(raw.state || '').trim().slice(0, 80),
      pincode: String(raw.pincode || '').replace(/\D/g, '').slice(0, 6),
      country: String(raw.country || 'India').trim() || 'India',
      phone: String(raw.phone || '').trim().slice(0, 20),
      isDefault: Boolean(raw.isDefault),
      lat: Number.isFinite(Number(raw.lat)) ? Number(raw.lat) : undefined,
      lng: Number.isFinite(Number(raw.lng)) ? Number(raw.lng) : undefined,
      display: String(raw.display || '').trim().slice(0, 240),
      source: raw.source === 'gps' ? 'gps' : 'manual',
    }))
    .filter((row) => row.line1 && row.city && /^\d{6}$/.test(row.pincode));
  if (cleaned.length && !cleaned.some((row) => row.isDefault)) cleaned[0].isDefault = true;
  let seen = false;
  return cleaned.map((row) => {
    if (!row.isDefault) return row;
    if (seen) return { ...row, isDefault: false };
    seen = true;
    return row;
  });
}

exports.updateProfile = asyncHandler(async (req, res) => {
  const { addresses } = req.body;
  const name = str(req.body.name, 100);
  if (name) req.user.name = name;
  if (req.body.phone !== undefined) req.user.phone = str(req.body.phone, 20);
  if (Array.isArray(addresses)) req.user.addresses = sanitizeAddresses(addresses.slice(0, 20));
  await req.user.save();
  res.json({ user: req.user.toPublic() });
});
