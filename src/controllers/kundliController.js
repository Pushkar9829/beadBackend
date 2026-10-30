const mongoose = require('mongoose');
const Kundli = require('../models/Kundli');
const { asyncHandler, escapeRegex, toStr } = require('../utils/asyncHandler');
const { parsePage, pageMeta } = require('../utils/pagination');
const kundli = require('../services/kundliService');
const astrology = require('../services/astrologyApi');

function badId(req, res) {
  if (mongoose.isValidObjectId(req.params.id)) return false;
  res.status(404).json({ message: 'Kundli not found.' });
  return true;
}

/* ---------------- customer ---------------- */

exports.mine = asyncHandler(async (req, res) => {
  res.json(await kundli.mine(req.user));
});

// PUT /api/kundli/details (signed in): home modal and Account → My Kundli.
exports.saveMine = asyncHandler(async (req, res) => {
  await kundli.saveDetails({ user: req.user, details: req.body });
  res.json(await kundli.mine(req.user));
});

// POST /api/kundli/details (signed out): stored by email until the customer's first qualifying order.
exports.savePublic = asyncHandler(async (req, res) => {
  if (req.user) {
    await kundli.saveDetails({ user: req.user, details: req.body });
    return res.status(201).json({ ok: true, signedIn: true });
  }
  await kundli.saveDetails({ email: req.body?.email, details: req.body });
  res.status(201).json({ ok: true });
});

exports.places = asyncHandler(async (req, res) => {
  res.json({ places: await kundli.searchPlaces(req.query.q) });
});

/* ---------------- admin ---------------- */

const LIST_FIELDS = '-sections.astro -sections.planets -sections.chartSvg -sections.dasha -sections.manglik -sections.gems -sections.rudraksha';

exports.adminList = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePage(req, 25);
  const filter = {};
  const status = toStr(req.query.status, 20);
  if (status && status !== 'all') {
    if (!Kundli.KUNDLI_STATUSES.includes(status)) return res.status(400).json({ message: 'Unknown Kundli status.' });
    filter.status = status;
  }
  const q = toStr(req.query.q, 100);
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ 'birth.name': rx }, { email: rx }, { eligibleOrderNumber: rx }];
  }
  const [rows, total, counts] = await Promise.all([
    Kundli.find(filter).select(LIST_FIELDS).populate('userId', 'name email').sort({ updatedAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
    Kundli.countDocuments(filter),
    Kundli.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
  ]);
  res.json({
    kundlis: rows,
    pagination: pageMeta(total, page, limit),
    counts: Object.fromEntries(counts.map((c) => [c._id, c.n])),
    api: { configured: astrology.isConfigured(), mock: astrology.isMock() },
  });
});

async function adminDoc(id) {
  return Kundli.findById(id).populate('userId', 'name email phone').populate('eligibleOrderId', 'orderNumber total subtotal discount status createdAt').lean();
}

exports.adminGet = asyncHandler(async (req, res) => {
  if (badId(req, res)) return;
  const doc = await adminDoc(req.params.id);
  if (!doc) return res.status(404).json({ message: 'Kundli not found.' });
  res.json({ kundli: doc, suggestions: doc.status === 'ready' ? await kundli.productsForSuggestions(doc) : {} });
});

// Fixes birth data. A record waiting for details starts generating; a generated one keeps its
// result until an admin presses Regenerate (each run spends credits).
exports.adminUpdateDetails = asyncHandler(async (req, res) => {
  if (badId(req, res)) return;
  const doc = await Kundli.findById(req.params.id);
  if (!doc) return res.status(404).json({ message: 'Kundli not found.' });
  if (doc.status === 'generating') return res.status(409).json({ message: 'This Kundli is generating. Try again when it finishes.' });
  doc.birth = kundli.cleanBirth(req.body);
  if (doc.status === 'details_needed' && doc.eligibleOrderId) await kundli.queue(doc);
  else await doc.save();
  res.json({ kundli: await adminDoc(doc._id) });
});

exports.adminGenerate = asyncHandler(async (req, res) => {
  if (badId(req, res)) return;
  const doc = await Kundli.findById(req.params.id);
  if (!doc) return res.status(404).json({ message: 'Kundli not found.' });
  if (!kundli.hasBirth(doc)) return res.status(400).json({ message: 'Add the birth details first.' });
  if (!astrology.isConfigured()) {
    return res.status(503).json({ message: 'AstrologyAPI is not configured. Add ASTROLOGY_API_USER_ID and ASTROLOGY_API_KEY on the server.' });
  }
  if (['generating', 'queued'].includes(doc.status)) return res.status(409).json({ message: 'This Kundli is already being generated.' });
  await kundli.queue(doc, { force: true });
  res.status(202).json({ kundli: await adminDoc(doc._id) });
});

exports.adminRemove = asyncHandler(async (req, res) => {
  if (badId(req, res)) return;
  const removed = await Kundli.findByIdAndDelete(req.params.id);
  if (!removed) return res.status(404).json({ message: 'Kundli not found.' });
  res.json({ ok: true });
});
