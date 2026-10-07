require('dotenv').config();
const StudioLayer = require('../models/StudioLayer');
const { catalogFor } = require('../data/studioLayers');

function toDoc(kind, item, index) {
  return {
    kind,
    slug: String(item.slug),
    sortOrder: index + 1,
    isActive: true,
    name: item.name || item.theme || '',
    description: item.description || '',
    image: item.image || '',
    icon: item.icon || '',
    hindi: item.hindi || '',
    dates: item.dates || '',
    fromMonth: item.fromMonth,
    fromDay: item.fromDay,
    toMonth: item.toMonth,
    toDay: item.toDay,
    number: item.number,
    theme: item.theme || '',
    suitable: item.suitable || [],
    recommended: item.recommended || [],
    mulank: item.mulank || [],
    bhagyank: item.bhagyank || [],
  };
}

const isDuplicateKey = (err) =>
  err?.code === 11000 || (Array.isArray(err?.writeErrors) && err.writeErrors.every((e) => (e.code ?? e.err?.code) === 11000));

/**
 * Startup-only, insert-only seeding of the default studio layer catalogs.
 * A kind is seeded only when it has no rows at all, so admin edits/deletions are never
 * overwritten. Duplicate-key errors (e.g. two instances booting at once) are tolerated.
 */
async function ensureStudioLayers() {
  const created = [];
  for (const kind of ['zodiac', 'numerology', 'planetary', 'profession']) {
    const count = await StudioLayer.countDocuments({ kind });
    if (count > 0) continue;
    const docs = catalogFor(kind).map((item, i) => toDoc(kind, item, i));
    if (!docs.length) continue;
    try {
      const inserted = await StudioLayer.insertMany(docs, { ordered: false });
      created.push(...inserted.map((doc) => `${kind}:${doc.slug}`));
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
      const ok = err.insertedDocs || [];
      created.push(...ok.map((doc) => `${kind}:${doc.slug}`));
    }
  }
  return { created };
}

async function restoreStudioLayers(kind) {
  const defaults = catalogFor(kind);
  if (!defaults.length) return { restored: 0 };
  await StudioLayer.deleteMany({ kind });
  const docs = defaults.map((item, i) => toDoc(kind, item, i));
  if (docs.length) await StudioLayer.insertMany(docs, { ordered: false });
  return { restored: docs.length };
}

module.exports = { ensureStudioLayers, restoreStudioLayers, toDoc };

if (require.main === module) {
  const { connectDb } = require('../config/db');
  connectDb()
    .then(() => ensureStudioLayers())
    .then((result) => {
      console.log(
        result.created.length
          ? `Studio layers added: ${result.created.join(', ')}`
          : 'Studio layers already present.'
      );
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
