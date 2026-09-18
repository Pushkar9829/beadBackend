require('dotenv').config();
const { connectDb } = require('../config/db');
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

async function ensureStudioLayers() {
  const created = [];
  for (const kind of ['zodiac', 'numerology', 'planetary', 'profession']) {
    const count = await StudioLayer.countDocuments({ kind });
    if (count > 0) continue;
    const defaults = catalogFor(kind);
    const docs = defaults.map((item, i) => toDoc(kind, item, i));
    if (!docs.length) continue;
    await StudioLayer.insertMany(docs);
    created.push(...docs.map((doc) => `${kind}:${doc.slug}`));
  }
  return { created };
}

async function restoreStudioLayers(kind) {
  const defaults = catalogFor(kind);
  if (!defaults.length) return { restored: 0 };
  await StudioLayer.deleteMany({ kind });
  const docs = defaults.map((item, i) => toDoc(kind, item, i));
  if (docs.length) await StudioLayer.insertMany(docs);
  return { restored: docs.length };
}

module.exports = { ensureStudioLayers, restoreStudioLayers, toDoc };

if (require.main === module) {
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
