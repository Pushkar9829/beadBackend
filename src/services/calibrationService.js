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
 * 3. Beads follow a fixed repeating pattern (A B C A B C…) around the bracelet.
 * 4. Remaining slots are filled round-robin with the other intention crystals.
 * 5. If includeZodiac, zodiac beads sit in a fixed clasp pair either side of the charm.
 */
function claspIndices(limit, want) {
  const out = [];
  let left = 0;
  let right = limit - 1;
  for (let k = 0; k < want; k += 1) {
    if (k % 2 === 0) out.push(left++);
    else out.push(right--);
  }
  return out;
}

function weaveRepeating(groups, limit) {
  const queues = groups
    .map((group) => group.filter(Boolean))
    .filter((group) => group.length);
  const layout = new Array(limit).fill(null);
  let cursor = 0;
  let guard = 0;
  while (cursor < limit && guard < limit * 8) {
    guard += 1;
    let placed = false;
    for (const queue of queues) {
      if (!queue.length || cursor >= limit) continue;
      layout[cursor] = queue.shift();
      cursor += 1;
      placed = true;
    }
    if (!placed) break;
  }
  return layout;
}

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
  const remaining = Math.max(0, limit - qtyPrimary);

  const primaryQueue = Array.from({ length: qtyPrimary }, () => ({
    ...slimBead(primary),
    role: 'intention-primary',
  }));

  const otherQueues = [];
  if (others.length) {
    others.forEach(() => otherQueues.push([]));
    for (let i = 0; i < remaining; i += 1) {
      const bead = others[i % others.length];
      otherQueues[i % others.length].push({ ...slimBead(bead), role: 'intention' });
    }
  } else {
    for (let i = 0; i < remaining; i += 1) {
      primaryQueue.push({ ...slimBead(primary), role: 'intention' });
    }
  }

  const layout = weaveRepeating([primaryQueue, ...otherQueues], limit);

  if (includeZodiac && zodiacBead) {
    const want = Math.min(Math.max(1, Number(zodiacQty) || 2), limit - 1);
    claspIndices(limit, want).forEach((index) => {
      layout[index] = { ...slimBead(zodiacBead), role: 'zodiac' };
    });
  }

  return layout.map((slot, i) => ({ ...slot, position: i + 1 }));
}

function explainCalibration({ mulank, beadLimit, qtyPrimary, zodiacQty, includeZodiac, zodiac }) {
  const parts = [
    `Mulank ${mulank} sets the primary crystal count at ${qtyPrimary} on a ${beadLimit}-bead strand.`,
    `Those stones follow a fixed repeating pattern around the bracelet, starting at the charm.`,
    'The other crystals chosen for this intention fill the remaining positions in the same sequence.',
  ];
  if (includeZodiac && zodiac?.sign) {
    parts.push(`${zodiac.sign} beads (${zodiacQty}) sit either side of the charm.`);
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
  const qtyZ = Number.isFinite(Number(zodiacQty)) && Number(zodiacQty) > 0
    ? Number(zodiacQty)
    : (config?.zodiacBeadCount || 2);
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
