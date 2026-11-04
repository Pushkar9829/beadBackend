// "Continue with WhatsApp": sign in / sign up with a one-time code sent by WhatsApp.
// 1. POST /api/auth/whatsapp/start { phone }            -> code sent (or 429 / 4xx)
// 2. POST /api/auth/whatsapp/verify { phone, code }     -> { user, token } for a verified number,
//                                                          or { needsProfile, signupToken } for a new one
// 3. POST /api/auth/whatsapp/complete { signupToken, name } -> new account { user, token }
// A number only signs in to an account after it was proven with a code (User.whatsappPhone); the free-text
// `phone` on old profiles is never trusted.
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Cart = require('../models/Cart');
const WhatsAppOtp = require('../models/WhatsAppOtp');
const WhatsAppSetting = require('../models/WhatsAppSetting');
const { asyncHandler } = require('../utils/asyncHandler');
const { signToken, setAuthCookie, jwtSecret } = require('../middleware/auth');
const wa = require('../services/whatsappService');

const MAX_ATTEMPTS = 5;
const RESEND_GAP_MS = 45 * 1000;
const PER_PHONE_HOUR = 5;
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;
// Must match the expiry shown in the approved template (otp_login says 2 minutes).
const ttlMs = () => Math.min(Math.max(Number(process.env.WHATSAPP_OTP_TTL_MIN) || 2, 1), 10) * 60 * 1000;

const codeHash = (phone, code) => crypto.createHmac('sha256', jwtSecret()).update(`wa-otp:${phone}:${code}`).digest('hex');
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

async function settings() {
  const doc = await WhatsAppSetting.findOneAndUpdate({ key: 'main' }, { $setOnInsert: { key: 'main' } }, { upsert: true, returnDocument: 'after' }).lean();
  return doc;
}

async function loginEnabled() {
  return wa.isConfigured() && (await settings()).enabled !== false;
}

function issue(res, user) {
  const token = signToken(user);
  setAuthCookie(res, token);
  return { user: user.toPublic(), token };
}

// GET /api/auth/whatsapp/status: whether the storefront shows "Continue with WhatsApp".
exports.status = asyncHandler(async (_req, res) => {
  res.json({ enabled: await loginEnabled(), ttlMinutes: ttlMs() / 60000 });
});

exports.start = asyncHandler(async (req, res) => {
  if (!(await loginEnabled())) return res.status(503).json({ message: 'WhatsApp sign-in is not available right now. Please use email.' });
  const phone = wa.normalizePhone(req.body?.phone);
  if (!phone) return res.status(400).json({ message: 'Please enter a valid mobile number with country code, e.g. +91 98xxxxxxxx.' });

  const now = Date.now();
  const recent = await WhatsAppOtp.find({ phone, createdAt: { $gte: new Date(now - 60 * 60 * 1000) } }).sort({ createdAt: -1 }).select('createdAt').lean();
  if (recent[0] && now - new Date(recent[0].createdAt).getTime() < RESEND_GAP_MS) {
    const wait = Math.ceil((RESEND_GAP_MS - (now - new Date(recent[0].createdAt).getTime())) / 1000);
    return res.status(429).json({ message: `Please wait ${wait} seconds before asking for a new code.`, retryAfter: wait });
  }
  if (recent.length >= PER_PHONE_HOUR) return res.status(429).json({ message: 'Too many codes for this number. Please try again in an hour or sign in with email.' });

  const code = wa.newCode();
  const doc = await WhatsAppOtp.create({
    phone,
    codeHash: codeHash(phone, code),
    expiresAt: new Date(now + ttlMs()),
    ip: String(req.ip || '').slice(0, 64),
    purgeAt: new Date(now + KEEP_MS),
  });
  try {
    const sent = await wa.sendOtp(phone, code);
    await WhatsAppOtp.updateOne({ _id: doc._id }, { $set: { messageId: sent.messageId } });
  } catch (err) {
    await WhatsAppOtp.updateOne({ _id: doc._id }, { $set: { status: 'send_failed', error: err.detail || err.message, expiresAt: new Date(now) } });
    return res.status(err.status || 502).json({ message: err.message });
  }
  res.json({
    ok: true,
    phone: `+${phone}`,
    expiresIn: ttlMs() / 1000,
    resendIn: RESEND_GAP_MS / 1000,
    // Local tests only (WHATSAPP_MOCK=1, never in production): the code is returned instead of sent.
    ...(wa.isMock() ? { devCode: code } : {}),
  });
});

exports.verify = asyncHandler(async (req, res) => {
  const phone = wa.normalizePhone(req.body?.phone);
  const code = String(req.body?.code ?? '').replace(/\D/g, '');
  if (!phone || code.length !== 6) return res.status(400).json({ message: 'Enter the 6-digit code from WhatsApp.' });

  const otp = await WhatsAppOtp.findOne({ phone, usedAt: { $exists: false }, status: { $ne: 'send_failed' } }).sort({ createdAt: -1 });
  if (!otp || otp.expiresAt.getTime() < Date.now()) return res.status(400).json({ message: 'This code has expired. Ask for a new one.', expired: true });
  if (otp.attempts >= MAX_ATTEMPTS) return res.status(429).json({ message: 'Too many wrong codes. Ask for a new one.', expired: true });

  const a = Buffer.from(codeHash(phone, code));
  const b = Buffer.from(otp.codeHash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    const n = (await WhatsAppOtp.findOneAndUpdate({ _id: otp._id }, { $inc: { attempts: 1 } }, { returnDocument: 'after' }))?.attempts || MAX_ATTEMPTS;
    const left = Math.max(0, MAX_ATTEMPTS - n);
    return res.status(400).json({ message: left ? `That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Too many wrong codes. Ask for a new one.', expired: !left });
  }
  // Single use: only the request that marks it used continues.
  const claimed = await WhatsAppOtp.findOneAndUpdate({ _id: otp._id, usedAt: { $exists: false } }, { $set: { usedAt: new Date() } });
  if (!claimed) return res.status(400).json({ message: 'This code was already used. Ask for a new one.', expired: true });

  const user = await User.findOne({ whatsappPhone: phone });
  if (user) {
    if (user.isActive === false) return res.status(401).json({ message: 'This account is disabled.' });
    await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });
    return res.json(issue(res, user));
  }
  const signupToken = jwt.sign({ ph: phone, p: 'wa_signup' }, jwtSecret(), { algorithm: 'HS256', expiresIn: '15m' });
  res.json({ needsProfile: true, signupToken, phone: `+${phone}` });
});

exports.complete = asyncHandler(async (req, res) => {
  let claims;
  try {
    claims = jwt.verify(String(req.body?.signupToken || ''), jwtSecret(), { algorithms: ['HS256'] });
  } catch {
    return res.status(400).json({ message: 'This sign-up link has expired. Please verify your number again.', expired: true });
  }
  if (claims?.p !== 'wa_signup' || !claims.ph) return res.status(400).json({ message: 'Invalid sign-up request.', expired: true });
  const phone = claims.ph;
  const name = str(req.body?.name, 100);
  if (name.length < 2) return res.status(400).json({ message: 'Please enter your name.' });

  const existing = await User.findOne({ whatsappPhone: phone });
  if (existing) return res.json(issue(res, existing)); // completed twice (double click)
  const user = await User.create({
    name,
    phone: `+${phone}`,
    whatsappPhone: phone,
    phoneVerifiedAt: new Date(),
    lastLoginAt: new Date(),
  });
  await Cart.create({ userId: user._id, items: [] }).catch(() => {});
  try {
    const { notify } = require('../services/notificationService');
    await notify({ type: 'new_customer', title: `New customer ${user.name}`, body: `${user.phone} (WhatsApp)`, link: '/admin/customers' });
  } catch {
    /* non-blocking */
  }
  res.status(201).json(issue(res, user));
});

/* ---------------- Meta webhook (delivery status) ---------------- */

// GET /api/whatsapp/webhook: Meta's subscription check.
exports.webhookVerify = (req, res) => {
  const token = wa.cfg().verifyToken;
  if (token && req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === token) {
    return res.status(200).type('text/plain').send(String(req.query['hub.challenge'] || ''));
  }
  return res.sendStatus(403);
};

const STATUS_RANK = { sent: 1, delivered: 2, read: 3, failed: 4 };

// POST /api/whatsapp/webhook: delivery receipts for the codes (signature-checked).
exports.webhook = asyncHandler(async (req, res) => {
  if (!wa.validSignature(req.rawBody, req.get('x-hub-signature-256'))) return res.sendStatus(401);
  const statuses = (req.body?.entry || []).flatMap((e) => (e.changes || []).flatMap((c) => c.value?.statuses || []));
  for (const s of statuses.slice(0, 100)) {
    if (!s?.id || !STATUS_RANK[s.status]) continue;
    const set = { status: s.status };
    if (s.status === 'failed') set.error = (s.errors || []).map((e) => `${e.code}: ${e.title || e.message || ''}`).join('; ').slice(0, 300);
    // Only move forward (a late "sent" never overwrites "read").
    const lower = Object.keys(STATUS_RANK).filter((k) => STATUS_RANK[k] < STATUS_RANK[s.status]);
    await WhatsAppOtp.updateOne({ messageId: s.id, status: { $in: [...lower, 'sent'] } }, { $set: set });
  }
  res.sendStatus(200);
});

/* ---------------- admin ---------------- */

exports.adminOverview = asyncHandler(async (_req, res) => {
  const since = new Date(Date.now() - KEEP_MS);
  const [doc, byStatus, verified, recent, linkedUsers] = await Promise.all([
    settings(),
    WhatsAppOtp.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    WhatsAppOtp.countDocuments({ createdAt: { $gte: since }, usedAt: { $exists: true } }),
    WhatsAppOtp.find({}).sort({ createdAt: -1 }).limit(15).select('phone status error usedAt createdAt attempts').lean(),
    User.countDocuments({ whatsappPhone: { $type: 'string' } }),
  ]);
  const counts = Object.fromEntries(byStatus.map((r) => [r._id, r.n]));
  res.json({
    enabled: doc.enabled !== false,
    configured: wa.isConfigured(),
    mock: wa.isMock(),
    webhook: { verifyTokenSet: Boolean(wa.cfg().verifyToken), appSecretSet: Boolean(wa.cfg().appSecret) },
    template: wa.cfg().template,
    ttlMinutes: ttlMs() / 60000,
    last7Days: { ...counts, verified, requested: Object.values(counts).reduce((a, b) => a + b, 0) },
    linkedUsers,
    recent: recent.map((r) => ({ id: r._id, phone: wa.maskPhone(r.phone), status: r.status, error: r.error || '', verified: Boolean(r.usedAt), attempts: r.attempts, createdAt: r.createdAt })),
  });
});

exports.adminSave = asyncHandler(async (req, res) => {
  if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ message: 'enabled must be true or false.' });
  await WhatsAppSetting.updateOne({ key: 'main' }, { $set: { enabled: req.body.enabled, updatedBy: req.user?._id } }, { upsert: true });
  res.json({ ok: true, enabled: req.body.enabled });
});
