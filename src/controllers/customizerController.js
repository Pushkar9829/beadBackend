const mongoose = require('mongoose');
const Purpose = require('../models/Purpose');
const Intention = require('../models/Intention');
const Bead = require('../models/Bead');
const Charm = require('../models/Charm');
const BraceletConfig = require('../models/BraceletConfig');
const IntentionBead = require('../models/IntentionBead');
const MulankCrystal = require('../models/MulankCrystal');
const ZodiacBead = require('../models/ZodiacBead');
const { getRecommendedBeads } = require('../services/recommendationService');
const { calculateCustomTotal } = require('../services/pricingService');
const { calibrate } = require('../services/calibrationService');
const { asyncHandler, slugifyName, cleanBody } = require('../utils/asyncHandler');

exports.purposes = asyncHandler(async (_req, res) => {
  const purposes = await Purpose.find({ isActive: true }).sort({ sortOrder: 1 }).lean();
  res.json({ purposes });
});

exports.intentions = asyncHandler(async (req, res) => {
  const { purposeId } = req.params;
  const filter = mongoose.Types.ObjectId.isValid(purposeId)
    ? { $or: [{ _id: purposeId }, { slug: purposeId }], isActive: true }
    : { slug: purposeId, isActive: true };
  const purpose = await Purpose.findOne(filter);
  if (!purpose) return res.status(404).json({ message: 'Purpose not found.' });
  const intentions = await Intention.find({ purposeId: purpose._id, isActive: true }).sort({ sortOrder: 1 }).lean();
  res.json({ purpose, intentions });
});

exports.recommendedBeads = asyncHandler(async (req, res) => {
  const intention = await Intention.findById(req.params.intentionId).lean();
  if (!intention) return res.status(404).json({ message: 'Intention not found.' });
  const beads = await getRecommendedBeads(intention._id);
  res.json({ intention, beads });
});

exports.charms = asyncHandler(async (_req, res) => {
  const charms = await ensureStudioCharms();
  res.json({ charms });
});

async function ensureStudioCharms() {
  const wanted = [
    {
      name: 'Sriyantra',
      slug: 'sriyantra',
      description: 'The Sriyantra charm — geometry of abundance at the clasp.',
      isActive: true,
      finishes: [{ key: 'gold', label: 'Gold', price: 299, metalColor: '#D4AF37' }],
    },
    {
      name: 'Om',
      slug: 'om',
      description: 'The Om charm — a quiet seal at the clasp.',
      isActive: true,
      finishes: [{ key: 'gold', label: 'Gold', price: 299, metalColor: '#E8D5A3' }],
    },
  ];
  const docs = [];
  for (const charm of wanted) {
    const saved = await Charm.findOneAndUpdate(
      { slug: charm.slug },
      charm,
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    docs.push(saved);
  }
  await Charm.updateMany({ slug: { $nin: ['sriyantra', 'om'] } }, { isActive: false });
  return docs.map((d) => (d.toObject ? d.toObject() : d));
}

exports.config = asyncHandler(async (_req, res) => {
  const config = await BraceletConfig.findOne().lean();
  res.json({ config });
});

exports.beads = asyncHandler(async (_req, res) => {
  const beads = await Bead.find({ isActive: true })
    .select('name slug image colorHex pricePerBead powerUse shortDescriptor')
    .sort({ name: 1 })
    .lean();
  res.json({ beads });
});

exports.calibrate = asyncHandler(async (req, res) => {
  const { intentionId, dateOfBirth, includeZodiac, zodiacQty, charmId, finishKey } = req.body || {};
  if (!intentionId) return res.status(400).json({ message: 'Choose an intention first.' });
  if (!dateOfBirth) return res.status(400).json({ message: 'Enter a date of birth.' });
  const intention = await Intention.findById(intentionId).populate('purposeId', 'name slug').lean();
  if (!intention) return res.status(404).json({ message: 'Intention not found.' });
  const result = await calibrate({
    intentionId,
    dateOfBirth,
    includeZodiac: Boolean(includeZodiac),
    zodiacQty,
    charmId,
    finishKey,
  });
  res.json({ intention, purpose: intention.purposeId, ...result });
});

exports.quote = asyncHandler(async (req, res) => {
  const config = await BraceletConfig.findOne().lean();
  const { beads = [], charmId, finishKey, addOns = 0 } = req.body;
  const charm = charmId ? await Charm.findById(charmId).lean() : await Charm.findOne({ isActive: true }).lean();
  const finish = charm?.finishes?.find((f) => f.key === finishKey) || charm?.finishes?.[0];
  const beadDocs = await Bead.find({ _id: { $in: beads.map((b) => b.beadId) } }).lean();
  const byId = Object.fromEntries(beadDocs.map((b) => [String(b._id), b]));
  const priced = beads.map((b) => ({
    ...b,
    name: byId[String(b.beadId)]?.name,
    pricePerBead: byId[String(b.beadId)]?.pricePerBead || 0,
  }));
  const quote = calculateCustomTotal({
    baseMakingPrice: config.baseMakingPrice,
    beads: priced,
    charmPrice: finish?.price || 0,
    addOns,
    beadLimit: config.beadLimit,
    minBeads: config.minBeads,
  });
  res.json({ quote, finish, charm, config });
});

exports.adminPurposes = asyncHandler(async (_req, res) => {
  const purposes = await Purpose.find().sort({ sortOrder: 1 }).lean();
  res.json({ purposes });
});

exports.adminSavePurpose = asyncHandler(async (req, res) => {
  const data = cleanBody(req.body);
  if (!data.slug && data.name) data.slug = slugifyName(data.name);
  const purpose = req.params.id
    ? await Purpose.findByIdAndUpdate(req.params.id, data, { new: true })
    : await Purpose.create(data);
  res.json({ purpose });
});

exports.adminDeletePurpose = asyncHandler(async (req, res) => {
  await Purpose.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

exports.adminIntentions = asyncHandler(async (req, res) => {
  const filter = req.query.purposeId ? { purposeId: req.query.purposeId } : {};
  const intentions = await Intention.find(filter).populate('purposeId', 'name').sort({ sortOrder: 1 }).lean();
  res.json({ intentions });
});

exports.adminSaveIntention = asyncHandler(async (req, res) => {
  const data = cleanBody(req.body);
  if (!data.slug && data.name) data.slug = slugifyName(data.name);
  const intention = req.params.id
    ? await Intention.findByIdAndUpdate(req.params.id, data, { new: true })
    : await Intention.create(data);
  res.json({ intention });
});

exports.adminDeleteIntention = asyncHandler(async (req, res) => {
  await Intention.findByIdAndDelete(req.params.id);
  await IntentionBead.deleteMany({ intentionId: req.params.id });
  res.json({ ok: true });
});

exports.adminBeads = asyncHandler(async (_req, res) => {
  const beads = await Bead.find().sort({ name: 1 }).lean();
  res.json({ beads });
});

exports.adminSaveBead = asyncHandler(async (req, res) => {
  const data = cleanBody(req.body);
  if (!data.slug && data.name) data.slug = slugifyName(data.name);
  if (typeof data.benefits === 'string') {
    data.benefits = data.benefits.split('\n').map((s) => s.trim()).filter(Boolean);
  }
  if (data.grade === '') delete data.grade;
  const bead = req.params.id
    ? await Bead.findByIdAndUpdate(req.params.id, data, { new: true })
    : await Bead.create(data);
  res.json({ bead });
});

exports.adminDeleteBead = asyncHandler(async (req, res) => {
  await Bead.findByIdAndDelete(req.params.id);
  await IntentionBead.deleteMany({ beadId: req.params.id });
  res.json({ ok: true });
});

exports.adminMappings = asyncHandler(async (req, res) => {
  const filter = req.query.intentionId ? { intentionId: req.query.intentionId } : {};
  const mappings = await IntentionBead.find(filter)
    .populate('intentionId', 'name')
    .populate('beadId', 'name pricePerBead')
    .sort({ sortOrder: 1 })
    .lean();
  res.json({ mappings });
});

exports.adminSaveMapping = asyncHandler(async (req, res) => {
  const data = cleanBody(req.body);
  const mapping = req.params.id
    ? await IntentionBead.findByIdAndUpdate(req.params.id, data, { new: true })
    : await IntentionBead.create(data);
  res.json({ mapping });
});

exports.adminDeleteMapping = asyncHandler(async (req, res) => {
  await IntentionBead.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

exports.adminMulank = asyncHandler(async (_req, res) => {
  const mappings = await MulankCrystal.find().populate('beadId', 'name pricePerBead').sort({ number: 1 }).lean();
  res.json({ mappings });
});

exports.adminSaveMulank = asyncHandler(async (req, res) => {
  const data = cleanBody(req.body);
  const mapping = req.params.id
    ? await MulankCrystal.findByIdAndUpdate(req.params.id, data, { new: true })
    : await MulankCrystal.findOneAndUpdate(
        { number: data.number },
        data,
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );
  res.json({ mapping });
});

exports.adminDeleteMulank = asyncHandler(async (req, res) => {
  await MulankCrystal.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

exports.adminZodiac = asyncHandler(async (_req, res) => {
  const mappings = await ZodiacBead.find().populate('beadId', 'name pricePerBead').sort({ fromMonth: 1, fromDay: 1 }).lean();
  res.json({ mappings });
});

exports.adminSaveZodiac = asyncHandler(async (req, res) => {
  const data = cleanBody(req.body);
  if (!data.slug && data.sign) data.slug = slugifyName(data.sign);
  const mapping = req.params.id
    ? await ZodiacBead.findByIdAndUpdate(req.params.id, data, { new: true })
    : await ZodiacBead.findOneAndUpdate(
        { slug: data.slug },
        data,
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );
  res.json({ mapping });
});

exports.adminDeleteZodiac = asyncHandler(async (req, res) => {
  await ZodiacBead.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

exports.adminCharms = asyncHandler(async (_req, res) => {
  await ensureStudioCharms();
  const charms = await Charm.find().lean();
  const config = await BraceletConfig.findOne().lean();
  res.json({ charms, config });
});

exports.adminSaveCharm = asyncHandler(async (req, res) => {
  const data = cleanBody(req.body);
  const charm = req.params.id
    ? await Charm.findByIdAndUpdate(req.params.id, data, { new: true })
    : await Charm.create(data);
  res.json({ charm });
});

exports.adminSaveConfig = asyncHandler(async (req, res) => {
  const data = cleanBody(req.body);
  let config = await BraceletConfig.findOne();
  if (!config) config = await BraceletConfig.create(data);
  else {
    Object.assign(config, data);
    await config.save();
  }
  res.json({ config });
});
