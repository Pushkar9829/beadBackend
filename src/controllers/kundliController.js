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

// PUT /api/kundli/details (signed in only): home modal and Account → My Kundli.
exports.saveMine = asyncHandler(async (req, res) => {
  await kundli.saveDetails({ user: req.user, details: req.body });
  res.json(await kundli.mine(req.user));
});

// POST /api/kundli/retry: re-runs a failed Kundli with the saved details (limited).
exports.retryMine = asyncHandler(async (req, res) => {
  await kundli.retry(req.user);
  res.json(await kundli.mine(req.user));
});

// GET /api/kundli/places (signed in; customers and staff): cached, capped per day.
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
    rules: await kundli.adminRules(),
  });
});

async function adminDoc(id) {
  const doc = await Kundli.findById(id)
    .populate('userId', 'name email phone')
    .populate('eligibleOrderId', 'orderNumber total subtotal discount status payment.method payment.status createdAt')
    .lean();
  if (!doc) return null;
  doc.pdfUrl = kundli.safePdfUrl(doc.pdfUrl);
  // Details edited since the stored sections were calculated (press Regenerate to apply them).
  doc.detailsChanged = Boolean(doc.generatedBirth && doc.birth && !kundli.sameBirth(doc.birth, doc.generatedBirth));
  doc.running = kundli.isRunning(doc);
  return doc;
}

exports.adminGet = asyncHandler(async (req, res) => {
  if (badId(req, res)) return;
  const doc = await adminDoc(req.params.id);
  if (!doc) return res.status(404).json({ message: 'Kundli not found.' });
  res.json({ kundli: doc, suggestions: doc.status === 'ready' ? await kundli.productsForSuggestions(doc) : {} });
});

// Fixes birth data (all staff). Only an admin save starts generation, and only for an eligible record that
// is waiting for details; a generated Kundli keeps its result until an admin presses Regenerate.
exports.adminUpdateDetails = asyncHandler(async (req, res) => {
  if (badId(req, res)) return;
  const doc = await kundli.adminSaveDetails(req.params.id, req.body, { role: req.user?.role });
  res.json({ kundli: await adminDoc(doc._id) });
});

exports.adminGenerate = asyncHandler(async (req, res) => {
  if (badId(req, res)) return;
  if (!astrology.isConfigured()) {
    return res.status(503).json({ message: 'AstrologyAPI is not configured. Add ASTROLOGY_API_KEY (the access token) on the server.' });
  }
  const doc = await kundli.adminGenerate(req.params.id);
  res.status(202).json({ kundli: await adminDoc(doc._id) });
});

// PUT /api/admin/kundli/settings (admin only): on/off, run limits, parts, customer caps, launch date.
exports.adminSaveSettings = asyncHandler(async (req, res) => {
  await kundli.saveSettings(req.body, req.user);
  res.json({ rules: await kundli.adminRules() });
});

exports.adminRemove = asyncHandler(async (req, res) => {
  if (badId(req, res)) return;
  const removed = await Kundli.findByIdAndDelete(req.params.id);
  if (!removed) return res.status(404).json({ message: 'Kundli not found.' });
  res.json({ ok: true });
});
