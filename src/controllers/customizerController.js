const mongoose = require('mongoose');
const Purpose = require('../models/Purpose');
const Intention = require('../models/Intention');
const Bead = require('../models/Bead');
const Charm = require('../models/Charm');
const BraceletConfig = require('../models/BraceletConfig');
const IntentionBead = require('../models/IntentionBead');
const MulankCrystal = require('../models/MulankCrystal');
const ZodiacBead = require('../models/ZodiacBead');
const Product = require('../models/Product');
const { mulankFromDate } = require('../services/numerologyService');
const { getSalePriceMap, applySaleToProduct } = require('../services/flashSaleService');
const { getRecommendedBeads } = require('../services/recommendationService');
const { calibrate } = require('../services/calibrationService');
const {
  asyncHandler,
  slugifyName,
  cleanBody,
  toStr,
  escapeRegex,
  mergeNestedKeys,
  takeNullsAsUnset,
  buildUpdate,
} = require('../utils/asyncHandler');

// Admin update options: return the updated doc and enforce schema validators (min/enum/required).
const UPDATE_OPTS = { returnDocument: 'after', runValidators: true };
const UPSERT_OPTS = { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true, runValidators: true };
const isObjectId = (value) =>
  (typeof value === 'string' || value instanceof mongoose.Types.ObjectId) && mongoose.Types.ObjectId.isValid(value);

function badId(res, label = 'record') {
  return res.status(400).json({ message: `Invalid ${label} id.` });
}
const { withStudioDefaults } = require('../data/studioConfigDefaults');
const studioLayers = require('../services/studioLayerService');
const StudioLayer = require('../models/StudioLayer');
const { KINDS: LAYER_KINDS } = StudioLayer;
const { restoreStudioLayers } = require('../seed/ensureStudioLayers');

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
  if (!isObjectId(req.params.intentionId)) return res.status(404).json({ message: 'Intention not found.' });
  const intention = await Intention.findById(req.params.intentionId).lean();
  if (!intention) return res.status(404).json({ message: 'Intention not found.' });
  const beads = await getRecommendedBeads(intention._id);
  res.json({ intention, beads });
});

// Default charms are seeded at startup (seed/ensureDefaultCharms via ensurePurposeCatalog);
// GET handlers never write.
exports.charms = asyncHandler(async (_req, res) => {
  const charms = await Charm.find({ isActive: true }).sort({ name: 1 }).lean();
  res.json({ charms });
});

exports.config = asyncHandler(async (_req, res) => {
  const config = withStudioDefaults(await BraceletConfig.findOne().lean());
  res.json({ config });
});

exports.beads = asyncHandler(async (_req, res) => {
  const [zodiacIds, mulankIds] = await Promise.all([
    ZodiacBead.find({ isActive: true }).distinct('beadId'),
    MulankCrystal.find({ isActive: true }).distinct('beadId'),
  ]);
  const mappedIds = [...zodiacIds, ...mulankIds].filter(Boolean);
  const beads = await Bead.find({
    $or: [{ isActive: true }, { _id: { $in: mappedIds } }],
  })
    .select('name slug image colorHex pricePerBead powerUse shortDescriptor')
    .sort({ name: 1 })
    .lean();
  res.json({ beads });
});

exports.studioLayerList = asyncHandler(async (req, res) => {
  const kind = String(req.params.kind || '');
  if (kind === 'purpose') {
    const purposes = await Purpose.find({ isActive: true }).sort({ sortOrder: 1 }).lean();
    return res.json({ kind, items: purposes });
  }
  const data = await studioLayers.listLayers(kind);
  if (!data) return res.status(404).json({ message: 'That customisation path was not found.' });
  res.json(data);
});

const FINDER_STONE_LIMIT = 3;
const FINDER_STONE_FIELDS = 'slug name image colorHex powerUse';
const FINDER_PRODUCT_FIELDS = '_id slug name price compareAtPrice images shortDescription family';

function finderStone(bead) {
  return {
    slug: bead.slug,
    name: bead.name,
    image: bead.image || '',
    colorHex: bead.colorHex || '',
    powerUse: bead.powerUse || '',
  };
}

/** Active beads for the given ids, in the order given, capped at FINDER_STONE_LIMIT. */
async function activeBeadsInOrder(ids) {
  if (!ids.length) return [];
  const docs = await Bead.find({ _id: { $in: ids }, isActive: true }).select(FINDER_STONE_FIELDS).lean();
  const byId = new Map(docs.map((b) => [String(b._id), b]));
  const seen = new Set();
  const out = [];
  for (const id of ids) {
    const key = String(id);
    const bead = byId.get(key);
    if (!bead || seen.has(key)) continue;
    seen.add(key);
    out.push(finderStone(bead));
    if (out.length >= FINDER_STONE_LIMIT) break;
  }
  return out;
}

async function finderProduct(stoneName) {
  if (!stoneName) return null;
  const rx = new RegExp(escapeRegex(stoneName), 'i');
  const product = await Product.findOne({ isActive: true, $or: [{ shortDescription: rx }, { name: rx }] })
    .sort({ rating: -1, reviewCount: -1, createdAt: -1 })
    .select(FINDER_PRODUCT_FIELDS)
    .lean();
  if (!product) return null;
  const sold = applySaleToProduct(product, await getSalePriceMap());
  const out = {};
  for (const key of FINDER_PRODUCT_FIELDS.split(' ')) out[key] = sold[key] ?? null;
  return out;
}

// GET /customizer/finder?purpose=<slug> | ?dob=YYYY-MM-DD — home "stone finder" suggestions.
exports.finder = asyncHandler(async (req, res) => {
  const purposeSlug = toStr(req.query.purpose, 120).toLowerCase();
  const dob = toStr(req.query.dob, 10);
  if (purposeSlug && dob) return res.status(400).json({ message: 'Send either purpose or dob, not both.' });

  if (purposeSlug) {
    if (!/^[a-z0-9-]+$/.test(purposeSlug)) return res.status(400).json({ message: 'Invalid purpose.' });
    const purpose = await Purpose.findOne({ slug: purposeSlug, isActive: true }).select('slug name').lean();
    if (!purpose) return res.status(404).json({ message: 'Purpose not found.' });
    const intention = await Intention.findOne({ purposeId: purpose._id, isActive: true })
      .sort({ sortOrder: 1, _id: 1 })
      .select('_id')
      .lean();
    const mappings = intention
      ? await IntentionBead.find({ intentionId: intention._id }).sort({ sortOrder: 1, _id: 1 }).select('beadId').lean()
      : [];
    const stones = await activeBeadsInOrder(mappings.map((m) => m.beadId));
    return res.json({
      mode: 'purpose',
      label: purpose.name,
      purpose: { slug: purpose.slug, name: purpose.name },
      stones,
      product: await finderProduct(stones[0]?.name),
      composeTo: `/customize?path=purpose&purpose=${encodeURIComponent(purpose.slug)}`,
    });
  }

  if (dob) {
    let mulank;
    try {
      mulank = mulankFromDate(dob);
    } catch (err) {
      return res.status(400).json({ message: err.message || 'Enter date of birth as YYYY-MM-DD.' });
    }
    const mappings = await MulankCrystal.find({ number: mulank, isActive: true }).sort({ _id: 1 }).select('beadId').lean();
    const stones = await activeBeadsInOrder(mappings.map((m) => m.beadId));
    return res.json({
      mode: 'dob',
      label: `Mulank ${mulank}`,
      purpose: null,
      stones,
      product: await finderProduct(stones[0]?.name),
      composeTo: '/customize?path=numerology',
    });
  }

  return res.status(400).json({ message: 'Send a purpose slug or a date of birth (YYYY-MM-DD).' });
});

exports.calibrate = asyncHandler(async (req, res) => {
  const { intentionId, dateOfBirth, includeZodiac, zodiacQty, charmId, finishKey, beadCount } = req.body || {};
  if (!intentionId) return res.status(400).json({ message: 'Choose an intention first.' });
  if (!dateOfBirth) return res.status(400).json({ message: 'Enter a date of birth.' });
  if (!isObjectId(intentionId)) return res.status(400).json({ message: 'Choose a valid intention.' });
  if (charmId != null && charmId !== '' && !isObjectId(charmId)) {
    return res.status(400).json({ message: 'Choose a valid charm.' });
  }
  const intention = await Intention.findById(intentionId).populate('purposeId', 'name slug').lean();
  if (!intention) return res.status(404).json({ message: 'Intention not found.' });
  const result = await calibrate({
    intentionId,
    dateOfBirth,
    includeZodiac: Boolean(includeZodiac),
    zodiacQty,
    beadCount,
    charmId: charmId || undefined,
    finishKey,
  });
  res.json({ intention, purpose: intention.purposeId, ...result });
});

exports.adminPurposes = asyncHandler(async (_req, res) => {
  const purposes = await Purpose.find().sort({ sortOrder: 1 }).lean();
  res.json({ purposes });
});

exports.adminSavePurpose = asyncHandler(async (req, res) => {
  if (req.params.id && !isObjectId(req.params.id)) return badId(res, 'purpose');
  const data = cleanBody(req.body);
  if (!data.slug && data.name) data.slug = slugifyName(data.name);
  const purpose = req.params.id
    ? await Purpose.findByIdAndUpdate(req.params.id, data, UPDATE_OPTS)
    : await Purpose.create(data);
  if (!purpose) return res.status(404).json({ message: 'Not found.' });
  res.json({ purpose });
});

exports.adminDeletePurpose = asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) return badId(res, 'purpose');
  await Purpose.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

exports.adminIntentions = asyncHandler(async (req, res) => {
  if (req.query.purposeId && !isObjectId(req.query.purposeId)) return badId(res, 'purpose');
  const filter = req.query.purposeId ? { purposeId: req.query.purposeId } : {};
  const intentions = await Intention.find(filter).populate('purposeId', 'name').sort({ sortOrder: 1 }).lean();
  res.json({ intentions });
});

exports.adminSaveIntention = asyncHandler(async (req, res) => {
  if (req.params.id && !isObjectId(req.params.id)) return badId(res, 'intention');
  const data = cleanBody(req.body);
  if (!data.slug && data.name) data.slug = slugifyName(data.name);
  const intention = req.params.id
    ? await Intention.findByIdAndUpdate(req.params.id, data, UPDATE_OPTS)
    : await Intention.create(data);
  if (!intention) return res.status(404).json({ message: 'Not found.' });
  res.json({ intention });
});

exports.adminDeleteIntention = asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) return badId(res, 'intention');
  await Intention.findByIdAndDelete(req.params.id);
  await IntentionBead.deleteMany({ intentionId: req.params.id });
  res.json({ ok: true });
});

exports.adminBeads = asyncHandler(async (_req, res) => {
  const beads = await Bead.find().sort({ name: 1 }).lean();
  res.json({ beads });
});

exports.adminSaveBead = asyncHandler(async (req, res) => {
  if (req.params.id && !isObjectId(req.params.id)) return badId(res, 'bead');
  const data = cleanBody(req.body);
  if (!data.slug && data.name) data.slug = slugifyName(data.name);
  if (typeof data.benefits === 'string') {
    data.benefits = data.benefits.split('\n').map((s) => s.trim()).filter(Boolean);
  }
  if (data.grade === '') delete data.grade;
  // Optional numbers sent as null are cleared.
  const $unset = takeNullsAsUnset(data, ['sizeMm', 'lowStockLimit']);
  const bead = req.params.id
    ? await Bead.findByIdAndUpdate(req.params.id, buildUpdate(data, $unset), UPDATE_OPTS)
    : await Bead.create(data);
  if (!bead) return res.status(404).json({ message: 'Not found.' });
  res.json({ bead });
});

exports.adminDeleteBead = asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) return badId(res, 'bead');
  await Bead.findByIdAndDelete(req.params.id);
  await IntentionBead.deleteMany({ beadId: req.params.id });
  res.json({ ok: true });
});

exports.adminMappings = asyncHandler(async (req, res) => {
  if (req.query.intentionId && !isObjectId(req.query.intentionId)) return badId(res, 'intention');
  const filter = req.query.intentionId ? { intentionId: req.query.intentionId } : {};
  const mappings = await IntentionBead.find(filter)
    .populate('intentionId', 'name')
    .populate('beadId', 'name pricePerBead')
    .sort({ sortOrder: 1 })
    .lean();
  res.json({ mappings });
});

exports.adminSaveMapping = asyncHandler(async (req, res) => {
  if (req.params.id && !isObjectId(req.params.id)) return badId(res, 'mapping');
  const data = cleanBody(req.body);
  const mapping = req.params.id
    ? await IntentionBead.findByIdAndUpdate(req.params.id, data, UPDATE_OPTS)
    : await IntentionBead.create(data);
  if (!mapping) return res.status(404).json({ message: 'Not found.' });
  res.json({ mapping });
});

exports.adminDeleteMapping = asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) return badId(res, 'mapping');
  await IntentionBead.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

exports.adminMulank = asyncHandler(async (_req, res) => {
  const mappings = await MulankCrystal.find().populate('beadId', 'name pricePerBead').sort({ number: 1 }).lean();
  res.json({ mappings });
});

exports.adminSaveMulank = asyncHandler(async (req, res) => {
  if (req.params.id && !isObjectId(req.params.id)) return badId(res, 'mapping');
  const data = cleanBody(req.body);
  const mapping = req.params.id
    ? await MulankCrystal.findByIdAndUpdate(req.params.id, data, UPDATE_OPTS)
    : await MulankCrystal.findOneAndUpdate(
        { number: data.number },
        data,
        UPSERT_OPTS
      );
  if (!mapping) return res.status(404).json({ message: 'Not found.' });
  res.json({ mapping });
});

exports.adminDeleteMulank = asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) return badId(res, 'mapping');
  await MulankCrystal.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

exports.adminZodiac = asyncHandler(async (_req, res) => {
  const mappings = await ZodiacBead.find().populate('beadId', 'name pricePerBead').sort({ fromMonth: 1, fromDay: 1 }).lean();
  res.json({ mappings });
});

exports.adminSaveZodiac = asyncHandler(async (req, res) => {
  if (req.params.id && !isObjectId(req.params.id)) return badId(res, 'mapping');
  const data = cleanBody(req.body);
  if (!data.slug && data.sign) data.slug = slugifyName(data.sign);
  const mapping = req.params.id
    ? await ZodiacBead.findByIdAndUpdate(req.params.id, data, UPDATE_OPTS)
    : await ZodiacBead.findOneAndUpdate(
        { slug: data.slug },
        data,
        UPSERT_OPTS
      );
  if (!mapping) return res.status(404).json({ message: 'Not found.' });
  res.json({ mapping });
});

exports.adminDeleteZodiac = asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) return badId(res, 'mapping');
  await ZodiacBead.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

exports.adminCharms = asyncHandler(async (_req, res) => {
  const charms = await Charm.find().sort({ name: 1 }).lean();
  const config = withStudioDefaults(await BraceletConfig.findOne().lean());
  res.json({ charms, config });
});

exports.adminSaveCharm = asyncHandler(async (req, res) => {
  if (req.params.id && !isObjectId(req.params.id)) return badId(res, 'charm');
  const data = cleanBody(req.body);
  if (!data.slug && data.name) data.slug = slugifyName(data.name);
  if (!Array.isArray(data.finishes) || !data.finishes.length) {
    // On update, a missing / empty finishes list keeps the stored finishes; new charms get a default.
    if (req.params.id) delete data.finishes;
    else data.finishes = [{ key: 'gold', label: 'Gold', price: 0, metalColor: '#D4AF37' }];
  }
  const charm = req.params.id
    ? await Charm.findByIdAndUpdate(req.params.id, data, UPDATE_OPTS)
    : await Charm.create(data);
  if (!charm) return res.status(404).json({ message: 'Not found.' });
  res.json({ charm });
});

exports.adminDeleteCharm = asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) return badId(res, 'charm');
  await Charm.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

exports.adminSaveConfig = asyncHandler(async (req, res) => {
  const data = cleanBody(req.body);
  delete data._id;
  delete data.__v;
  delete data.createdAt;
  delete data.updatedAt;
  if (Array.isArray(data.beadSizesMm)) {
    data.beadSizesMm = data.beadSizesMm.map(Number).filter((n) => Number.isFinite(n) && n > 0);
  }
  let config = await BraceletConfig.findOne();
  if (Array.isArray(data.czOptions)) {
    data.czOptions = data.czOptions.map((row) => ({
      ...row,
      price: Number(row.price) || 0,
    }));
    // packaging.cz mirrors the 'cz' option and packaging.roundCz mirrors the 'round' option.
    const cz = data.czOptions.find((row) => row.key === 'cz');
    const round = data.czOptions.find((row) => row.key === 'round');
    const currentPackaging = config?.packaging
      ? (typeof config.packaging.toObject === 'function' ? config.packaging.toObject() : { ...config.packaging })
      : {};
    data.packaging = {
      ...currentPackaging,
      ...(data.packaging || {}),
    };
    if (cz) data.packaging.cz = Number(cz.price) || 0;
    if (round) data.packaging.roundCz = Number(round.price) || 0;
  }
  if (!config) config = await BraceletConfig.create(data);
  else {
    // packaging / packagingLabels merge per field instead of replacing the whole sub-object.
    for (const [path, value] of Object.entries(mergeNestedKeys(data, ['packaging', 'packagingLabels']))) {
      config.set(path, value);
    }
    await config.save();
  }
  res.json({ config: withStudioDefaults(config.toObject()) });
});

function parseNameList(value) {
  if (Array.isArray(value)) return value.map((s) => String(s).trim()).filter(Boolean);
  return String(value || '')
    .split(/[,•\n|;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeLayerBody(body) {
  const data = cleanBody(body);
  ['suitable', 'recommended', 'mulank', 'bhagyank'].forEach((key) => {
    if (data[key] != null) data[key] = parseNameList(data[key]);
  });
  if (data.number != null && data.number !== '') data.number = Number(data.number);
  if (!data.slug && data.name) data.slug = slugifyName(data.name);
  if (!data.slug && data.number != null) data.slug = String(data.number);
  ['fromMonth', 'fromDay', 'toMonth', 'toDay', 'sortOrder'].forEach((key) => {
    if (data[key] === '' || data[key] == null) {
      delete data[key];
      return;
    }
    data[key] = Number(data[key]);
  });
  return data;
}

exports.adminLayers = asyncHandler(async (req, res) => {
  // Layers are seeded at startup; this read never writes.
  const kind = typeof req.query.kind === 'string' ? req.query.kind : '';
  const filter = kind ? { kind } : {};
  const items = await StudioLayer.find(filter).sort({ kind: 1, sortOrder: 1, number: 1, name: 1 }).lean();
  res.json({ items });
});

exports.adminSaveLayer = asyncHandler(async (req, res) => {
  if (req.params.id && !isObjectId(req.params.id)) return badId(res, 'layer');
  const data = normalizeLayerBody(req.body);
  if (!LAYER_KINDS.includes(data.kind)) return res.status(400).json({ message: 'Choose a catalog kind.' });
  if (!data.slug) return res.status(400).json({ message: 'A slug or name is required.' });
  const item = req.params.id
    ? await StudioLayer.findByIdAndUpdate(req.params.id, data, UPDATE_OPTS)
    : await StudioLayer.findOneAndUpdate(
        { kind: data.kind, slug: data.slug },
        data,
        UPSERT_OPTS
      );
  if (!item) return res.status(404).json({ message: 'Catalog row not found.' });
  res.json({ item });
});

exports.adminDeleteLayer = asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) return badId(res, 'layer');
  await StudioLayer.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

exports.adminRestoreLayers = asyncHandler(async (req, res) => {
  const kind = String(req.body.kind || req.query.kind || '');
  if (!LAYER_KINDS.includes(kind)) {
    return res.status(400).json({ message: 'Choose a catalog to restore.' });
  }
  const result = await restoreStudioLayers(kind);
  res.json(result);
});
