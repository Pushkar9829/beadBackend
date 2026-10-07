require('dotenv').config();
const Purpose = require('../models/Purpose');
const Intention = require('../models/Intention');
const IntentionBead = require('../models/IntentionBead');
const Bead = require('../models/Bead');
const BraceletConfig = require('../models/BraceletConfig');
const { slugifyName } = require('../utils/asyncHandler');
const { PURPOSES, INTENTIONS, crystalNames } = require('../data/purposeCatalog');
const { defaultPackaging } = require('../services/pricingService');
const { ensureDefaultCharms } = require('./ensureDefaultCharms');

/**
 * Runs on every server start. Strictly insert-only / non-destructive:
 * - creates missing purposes, intentions and intention->bead mappings;
 * - never overwrites admin edits (names, descriptions, sort order, isActive);
 * - never deactivates admin-created purposes/intentions;
 * - never replaces mappings for intentions that already have any;
 * - only fills BraceletConfig fields that are missing.
 */

const isDuplicateKey = (err) =>
  err?.code === 11000 || (Array.isArray(err?.writeErrors) && err.writeErrors.every((e) => (e.code ?? e.err?.code) === 11000));

function resolveBead(byName, name) {
  const key = String(name || '').toLowerCase();
  return byName.get(key) || byName.get(key.replace('black obsidian', 'obsidian')) || null;
}

async function insertIfMissing(Model, filter, doc) {
  const existing = await Model.findOne(filter);
  if (existing) return { doc: existing, created: false };
  try {
    return { doc: await Model.create(doc), created: true };
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
    return { doc: await Model.findOne(filter), created: false };
  }
}

const CONFIG_DEFAULTS = {
  beadLimit: 32,
  minBeads: 1,
  baseMakingPrice: 0,
  defaultWristSize: '6.5"',
  beadSizesMm: [6, 8, 10],
  defaultBeadSizeMm: 8,
};

async function ensureBraceletConfig() {
  const packaging = defaultPackaging();
  const existing = await BraceletConfig.findOne().lean();
  if (!existing) {
    try {
      await BraceletConfig.create({ ...CONFIG_DEFAULTS, packaging });
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
    }
    return;
  }
  // Only fill fields that are genuinely missing; never overwrite admin-edited values.
  const $set = {};
  Object.entries(CONFIG_DEFAULTS).forEach(([key, value]) => {
    const current = existing[key];
    if (current == null || (Array.isArray(current) && !current.length)) $set[key] = value;
  });
  Object.entries(packaging).forEach(([key, value]) => {
    if (existing.packaging?.[key] == null) $set[`packaging.${key}`] = value;
  });
  if (Object.keys($set).length) {
    await BraceletConfig.updateOne({ _id: existing._id }, { $set });
  }
}

async function ensurePurposeCatalog() {
  const beads = await Bead.find().lean();
  const byName = new Map(beads.map((b) => [String(b.name).toLowerCase(), b]));

  let purposesCreated = 0;
  for (let i = 0; i < PURPOSES.length; i += 1) {
    const row = PURPOSES[i];
    const slug = slugifyName(row.name);
    const { created } = await insertIfMissing(
      Purpose,
      { slug },
      { name: row.name, slug, description: row.description, sortOrder: i + 1, isActive: true }
    );
    if (created) purposesCreated += 1;
  }

  let intentionsCreated = 0;
  const unmatched = new Set();
  for (let i = 0; i < INTENTIONS.length; i += 1) {
    const [purposeName, name, braceletName, crystals] = INTENTIONS[i];
    const purpose = await Purpose.findOne({ slug: slugifyName(purposeName) });
    if (!purpose) continue;
    const slug = `${purpose.slug}-${slugifyName(name)}`.slice(0, 80);
    const { doc: intention, created } = await insertIfMissing(
      Intention,
      { slug },
      {
        purposeId: purpose._id,
        name,
        slug,
        braceletName,
        description: `Traditionally associated with ${name.toLowerCase()}. Design name: ${braceletName}.`,
        sortOrder: i + 1,
        isActive: true,
      }
    );
    if (!intention) continue;
    if (created) intentionsCreated += 1;

    // Only seed mappings for intentions that have none; never replace admin-curated mappings.
    const hasMappings = await IntentionBead.exists({ intentionId: intention._id });
    if (hasMappings) continue;

    const links = [];
    const seen = new Set();
    const names = crystalNames(crystals);
    // All-or-nothing: a partial mapping would make the wrong crystal primary and, because seeding
    // skips intentions that already have links, would never be completed later.
    const missing = names.filter((crystal) => !resolveBead(byName, crystal));
    if (missing.length) {
      missing.forEach((crystal) => unmatched.add(crystal));
      continue;
    }
    names.forEach((crystal) => {
      const bead = resolveBead(byName, crystal);
      if (seen.has(String(bead._id))) return;
      seen.add(String(bead._id));
      links.push({
        intentionId: intention._id,
        beadId: bead._id,
        reason: `Traditionally associated with ${name} in the Kuberstones catalog.`,
        sortOrder: links.length + 1,
      });
    });
    if (links.length) {
      try {
        await IntentionBead.insertMany(links, { ordered: false });
      } catch (err) {
        if (!isDuplicateKey(err)) throw err;
      }
    }
  }
  if (unmatched.size) {
    console.warn(`[ensurePurposeCatalog] No bead found for crystal name(s), skipped: ${[...unmatched].join(', ')}`);
  }

  await ensureBraceletConfig();
  await ensureDefaultCharms();

  return { purposes: purposesCreated, intentions: intentionsCreated };
}

module.exports = { ensurePurposeCatalog };

if (require.main === module) {
  const { connectDb } = require('../config/db');
  connectDb()
    .then(() => ensurePurposeCatalog())
    .then((result) => {
      console.log(`Purpose catalog: ${result.purposes} purposes, ${result.intentions} intentions added.`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
