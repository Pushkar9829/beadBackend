require('dotenv').config();
const { connectDb } = require('../config/db');
const Purpose = require('../models/Purpose');
const Intention = require('../models/Intention');
const IntentionBead = require('../models/IntentionBead');
const Bead = require('../models/Bead');
const BraceletConfig = require('../models/BraceletConfig');
const { slugifyName } = require('../utils/asyncHandler');
const { PURPOSES, INTENTIONS, crystalNames } = require('../data/purposeCatalog');
const { defaultPackaging } = require('../services/pricingService');

function resolveBead(byName, name) {
  const key = String(name || '').toLowerCase();
  return (
    byName.get(key) ||
    byName.get(key.replace('black obsidian', 'obsidian')) ||
    byName.get('obsidian')
  );
}

async function ensurePurposeCatalog() {
  const beads = await Bead.find().lean();
  const byName = new Map(beads.map((b) => [String(b.name).toLowerCase(), b]));

  const purposeIds = [];
  for (let i = 0; i < PURPOSES.length; i += 1) {
    const row = PURPOSES[i];
    const slug = slugifyName(row.name);
    const purpose = await Purpose.findOneAndUpdate(
      { slug },
      { name: row.name, slug, description: row.description, sortOrder: i + 1, isActive: true },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    purposeIds.push(purpose._id);
  }

  await Purpose.updateMany({ _id: { $nin: purposeIds } }, { isActive: false });

  const keepIntentionIds = [];
  for (let i = 0; i < INTENTIONS.length; i += 1) {
    const [purposeName, name, braceletName, crystals] = INTENTIONS[i];
    const purpose = await Purpose.findOne({ slug: slugifyName(purposeName) });
    if (!purpose) continue;
    const slug = `${purpose.slug}-${slugifyName(name)}`.slice(0, 80);
    const intention = await Intention.findOneAndUpdate(
      { slug },
      {
        purposeId: purpose._id,
        name,
        slug,
        braceletName,
        description: `Traditionally associated with ${name.toLowerCase()}. Design name: ${braceletName}.`,
        sortOrder: i + 1,
        isActive: true,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    keepIntentionIds.push(intention._id);

    const names = crystalNames(crystals);
    await IntentionBead.deleteMany({ intentionId: intention._id });
    const links = [];
    names.forEach((crystal, idx) => {
      const bead = resolveBead(byName, crystal);
      if (!bead) return;
      links.push({
        intentionId: intention._id,
        beadId: bead._id,
        reason: `Traditionally associated with ${name} in the Kuberstones catalog.`,
        sortOrder: idx + 1,
      });
    });
    if (links.length) await IntentionBead.insertMany(links);
  }

  await Intention.updateMany({ _id: { $nin: keepIntentionIds } }, { isActive: false });

  const packaging = defaultPackaging();
  await BraceletConfig.findOneAndUpdate(
    {},
    {
      $set: {
        beadLimit: 32,
        minBeads: 1,
        baseMakingPrice: 0,
        defaultWristSize: '6.5"',
        beadSizesMm: [6, 8, 10],
        defaultBeadSizeMm: 8,
        packaging,
      },
    },
    { upsert: true, setDefaultsOnInsert: true },
  );

  return { purposes: purposeIds.length, intentions: keepIntentionIds.length };
}

module.exports = { ensurePurposeCatalog };

if (require.main === module) {
  connectDb()
    .then(() => ensurePurposeCatalog())
    .then((result) => {
      console.log(`Purpose catalog: ${result.purposes} purposes, ${result.intentions} intentions.`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
