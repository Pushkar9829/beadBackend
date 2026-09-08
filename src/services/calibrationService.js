const Bead = require('../models/Bead');
const MulankCrystal = require('../models/MulankCrystal');
const ZodiacBead = require('../models/ZodiacBead');
const BraceletConfig = require('../models/BraceletConfig');
const Charm = require('../models/Charm');
const { getRecommendedBeads } = require('./recommendationService');
const { calculateCustomTotal } = require('./pricingService');
const {
  MULANK_FALLBACK,
  parseDateParts,
  mulankFromDate,
  bhagyankFromDate,
  zodiacFromDate,
  dateRangeLabel,
} = require('./numerologyService');

function slimBead(bead) {
  if (!bead) return null;
  return {
    _id: bead._id,
    beadId: bead._id,
    name: bead.name,
    slug: bead.slug,
    image: bead.image,
    colorHex: bead.colorHex,
    pricePerBead: bead.pricePerBead,
    powerUse: bead.powerUse,
    shortDescriptor: bead.shortDescriptor,
    reason: bead.reason,
  };
}

async function beadByName(name) {
  if (!name) return null;
  return Bead.findOne({ name, isActive: true }).lean();
}

async function resolveMulankCrystal(mulank) {
  const mapped = await MulankCrystal.findOne({ number: mulank, isActive: true }).populate('beadId').lean();
  if (mapped?.beadId && mapped.beadId.isActive !== false) {
    return { ...slimBead(mapped.beadId), reason: mapped.reason, source: 'mapping' };
  }
  const fallback = MULANK_FALLBACK[mulank];
  const bead = await beadByName(fallback?.beadName);
  if (!bead) return null;
  return { ...slimBead(bead), reason: fallback.reason, source: 'fallback' };
}

async function resolveZodiac(iso) {
  const stored = await ZodiacBead.find({ isActive: true }).populate('beadId').lean();
  const ranges = stored.length
    ? stored.map((z) => ({
        ...z,
        beadName: z.beadId?.name,
      }))
    : undefined;
  const sign = zodiacFromDate(iso, ranges);
  const bead = sign.beadId && typeof sign.beadId === 'object'
    ? sign.beadId
    : await beadByName(sign.beadName);
  return {
    sign: sign.sign,
    slug: sign.slug,
    dateRange: dateRangeLabel(sign),
    fromMonth: sign.fromMonth,
    fromDay: sign.fromDay,
    toMonth: sign.toMonth,
    toDay: sign.toDay,
    reason: sign.reason || `${sign.sign} is traditionally paired with ${bead?.name || 'a supporting bead'}.`,
    bead: bead && bead.isActive !== false ? slimBead(bead) : null,
  };
}

function quantitiesFromLayout(layout) {
  const map = new Map();
  layout.forEach((slot) => {
    const id = String(slot.beadId);
    if (!map.has(id)) {
      map.set(id, {
        beadId: slot.beadId,
        name: slot.name,
        slug: slot.slug,
        image: slot.image,
        colorHex: slot.colorHex,
        pricePerBead: slot.pricePerBead,
        powerUse: slot.powerUse,
        quantity: 0,
        roles: new Set(),
      });
    }
    const row = map.get(id);
    row.quantity += 1;
    row.roles.add(slot.role);
  });
  return [...map.values()].map((row) => ({ ...row, roles: [...row.roles] }));
}

/**
 * Required calibration:
 * 1. Strand length is the configured bead limit.
 * 2. The first intention crystal is the primary; its count equals Mulank.
 * 3. Primary stones start at index (Mulank - 1) and repeat at even intervals.
 * 4. Remaining slots are filled round-robin with the other intention crystals.
 * 5. If includeZodiac, zodiac beads replace that many non-primary slots (default 2).
 */
function buildLayout({ intentionBeads, mulank, beadLimit, zodiacBead, includeZodiac, zodiacQty }) {
  const limit = Math.max(1, Number(beadLimit) || 18);
  const crystals = (intentionBeads || []).filter(Boolean);
  if (!crystals.length) {
    const err = new Error('This intention has no crystals mapped yet.');
    err.status = 400;
    throw err;
  }

  const primary = crystals[0];
  const others = crystals.slice(1);
  const qtyPrimary = Math.min(Math.max(1, Number(mulank) || 1), limit);
  const layout = new Array(limit).fill(null);
  const gap = Math.max(1, Math.floor(limit / qtyPrimary));
  const start = (qtyPrimary - 1) % limit;

  for (let k = 0; k < qtyPrimary; k += 1) {
    const index = (start + k * gap) % limit;
    if (!layout[index]) {
      layout[index] = { ...slimBead(primary), role: 'intention-primary', position: index + 1 };
    } else {
      const empty = layout.findIndex((slot) => !slot);
      if (empty >= 0) {
        layout[empty] = { ...slimBead(primary), role: 'intention-primary', position: empty + 1 };
      }
    }
  }

  let cursor = 0;
  const fillers = others.length ? others : crystals;
  for (let i = 0; i < limit; i += 1) {
    if (layout[i]) continue;
    const bead = fillers[cursor % fillers.length];
    layout[i] = { ...slimBead(bead), role: 'intention', position: i + 1 };
    cursor += 1;
  }

  if (includeZodiac && zodiacBead) {
    const want = Math.min(Math.max(1, Number(zodiacQty) || 2), limit - 1);
    let placed = 0;
    for (let i = limit - 1; i >= 0 && placed < want; i -= 1) {
      if (layout[i]?.role === 'intention-primary') continue;
      layout[i] = { ...slimBead(zodiacBead), role: 'zodiac', position: i + 1 };
      placed += 1;
    }
  }

  return layout.map((slot, i) => ({ ...slot, position: i + 1 }));
}

function explainCalibration({ mulank, beadLimit, qtyPrimary, zodiacQty, includeZodiac, zodiac }) {
  const parts = [
    `Mulank ${mulank} sets the primary crystal count at ${qtyPrimary} on a ${beadLimit}-bead strand.`,
    `Those stones start at position ${((mulank - 1) % beadLimit) + 1} and are spaced evenly around the bracelet.`,
    'Remaining positions are filled with the other crystals chosen for this intention.',
  ];
  if (includeZodiac && zodiac?.sign) {
    parts.push(`${zodiac.sign} beads (${zodiacQty}) are then added in the remaining calibrated slots.`);
  }
  return parts.join(' ');
}

async function calibrate({
  intentionId,
  dateOfBirth,
  includeZodiac = false,
  zodiacQty,
  charmId,
  finishKey,
}) {
  parseDateParts(dateOfBirth);
  const mulank = mulankFromDate(dateOfBirth);
  const bhagyank = bhagyankFromDate(dateOfBirth);
  const [intentionBeads, mulankCrystal, zodiac, config] = await Promise.all([
    getRecommendedBeads(intentionId),
    resolveMulankCrystal(mulank),
    resolveZodiac(dateOfBirth),
    BraceletConfig.findOne().lean(),
  ]);

  const beadLimit = config?.beadLimit || 18;
  const qtyZ = Number(zodiacQty || config?.zodiacBeadCount || 2);
  const layout = buildLayout({
    intentionBeads,
    mulank,
    beadLimit,
    zodiacBead: zodiac.bead,
    includeZodiac: Boolean(includeZodiac),
    zodiacQty: qtyZ,
  });

  const charm = charmId
    ? await Charm.findById(charmId).lean()
    : await Charm.findOne({ isActive: true }).lean();
  const finish = charm?.finishes?.find((f) => f.key === finishKey) || charm?.finishes?.[0];
  const beads = quantitiesFromLayout(layout);
  const quote = calculateCustomTotal({
    baseMakingPrice: config?.baseMakingPrice || 0,
    beads,
    charmPrice: finish?.price || 0,
    addOns: 0,
    beadLimit,
    minBeads: config?.minBeads || 1,
  });

  const qtyPrimary = layout.filter((s) => s.role === 'intention-primary').length;

  return {
    dateOfBirth,
    mulank,
    bhagyank,
    mulankCrystal,
    zodiac,
    intentionBeads: intentionBeads.map(slimBead),
    layout,
    beads,
    includeZodiac: Boolean(includeZodiac),
    zodiacQty: qtyZ,
    explanation: explainCalibration({
      mulank,
      beadLimit,
      qtyPrimary,
      zodiacQty: qtyZ,
      includeZodiac,
      zodiac,
    }),
    quote,
    charm,
    finish,
    config,
  };
}

module.exports = {
  calibrate,
  buildLayout,
  quantitiesFromLayout,
  resolveMulankCrystal,
  resolveZodiac,
};
