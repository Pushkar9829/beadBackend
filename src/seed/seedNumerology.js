const Bead = require('../models/Bead');
const MulankCrystal = require('../models/MulankCrystal');
const ZodiacBead = require('../models/ZodiacBead');
const BraceletConfig = require('../models/BraceletConfig');
const { slugifyName } = require('../utils/asyncHandler');
const { ZODIAC_FALLBACK, MULANK_FALLBACK } = require('../services/numerologyService');

async function seedNumerologyMappings(beadByName) {
  const beads = beadByName || Object.fromEntries(
    (await Bead.find({ isActive: true }).lean()).map((b) => [b.name, b])
  );

  const mulankDocs = Object.entries(MULANK_FALLBACK).map(([number, meta]) => {
    const bead = beads[meta.beadName];
    if (!bead) return null;
    return {
      number: Number(number),
      beadId: bead._id,
      reason: meta.reason,
      isActive: true,
    };
  }).filter(Boolean);

  await MulankCrystal.deleteMany({});
  if (mulankDocs.length) await MulankCrystal.insertMany(mulankDocs);

  const zodiacDocs = ZODIAC_FALLBACK.map((z) => {
    const bead = beads[z.beadName];
    if (!bead) return null;
    return {
      sign: z.sign,
      slug: slugifyName(z.sign),
      fromMonth: z.fromMonth,
      fromDay: z.fromDay,
      toMonth: z.toMonth,
      toDay: z.toDay,
      beadId: bead._id,
      reason: `${z.sign} is paired with ${z.beadName} for this bracelet’s zodiac beads.`,
      isActive: true,
    };
  }).filter(Boolean);

  await ZodiacBead.deleteMany({});
  if (zodiacDocs.length) await ZodiacBead.insertMany(zodiacDocs);

  await BraceletConfig.updateMany({}, { $set: { zodiacBeadCount: 2 } });

  return { mulank: mulankDocs.length, zodiac: zodiacDocs.length };
}

module.exports = { seedNumerologyMappings };
