const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Cart = require('../models/Cart');
const { asyncHandler } = require('../utils/asyncHandler');
const { signToken, setAuthCookie, clearAuthCookie } = require('../middleware/auth');

exports.register = asyncHandler(async (req, res) => {
  const { name, email, password, phone } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ message: 'Name, email and password are required.' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters.' });
  }
  const exists = await User.findOne({ email: email.toLowerCase() });
  if (exists) return res.status(409).json({ message: 'An account with this email already exists.' });

  const passwordHash = await bcrypt.hash(password, 10);
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
  const { email, password } = req.body;
  const user = await User.findOne({ email: String(email || '').toLowerCase() });
  if (!user) return res.status(401).json({ message: 'Invalid email or password.' });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ message: 'Invalid email or password.' });
  const token = signToken(user);
  setAuthCookie(res, token);
  res.json({ user: user.toPublic(), token });
});

exports.logout = asyncHandler(async (_req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

exports.me = asyncHandler(async (req, res) => {
  if (!req.user) return res.json({ user: null, token: null });
  res.json({ user: req.user.toPublic() });
});

function sanitizeAddresses(list = []) {
  const cleaned = list
    .map((raw) => ({
      ...(raw._id ? { _id: raw._id } : {}),
      label: String(raw.label || 'Home').trim().slice(0, 40) || 'Home',
      line1: String(raw.line1 || '').trim(),
      line2: String(raw.line2 || '').trim(),
      city: String(raw.city || '').trim(),
      state: String(raw.state || '').trim(),
      pincode: String(raw.pincode || '').replace(/\D/g, '').slice(0, 6),
      country: String(raw.country || 'India').trim() || 'India',
      phone: String(raw.phone || '').trim(),
      isDefault: Boolean(raw.isDefault),
      lat: Number.isFinite(Number(raw.lat)) ? Number(raw.lat) : undefined,
      lng: Number.isFinite(Number(raw.lng)) ? Number(raw.lng) : undefined,
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
  const { name, phone, addresses } = req.body;
  if (name) req.user.name = name;
  if (phone !== undefined) req.user.phone = phone;
  if (Array.isArray(addresses)) req.user.addresses = sanitizeAddresses(addresses);
  await req.user.save();
  res.json({ user: req.user.toPublic() });
});
