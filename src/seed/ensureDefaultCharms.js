const Charm = require('../models/Charm');

const DEFAULT_CHARMS = [
  {
    name: 'Sriyantra',
    slug: 'sriyantra',
    description: 'The Sriyantra charm — geometry of abundance at the clasp.',
    isActive: true,
    finishes: [{ key: 'gold', label: 'Gold', price: 0, metalColor: '#D4AF37' }],
  },
  {
    name: 'Om',
    slug: 'om',
    description: 'The Om charm — a quiet seal at the clasp.',
    isActive: true,
    finishes: [{ key: 'gold', label: 'Gold', price: 0, metalColor: '#E8D5A3' }],
  },
];

/** Insert-only: creates the default charms if their slug is missing. Startup use only. */
async function ensureDefaultCharms() {
  const created = [];
  for (const charm of DEFAULT_CHARMS) {
    const res = await Charm.updateOne({ slug: charm.slug }, { $setOnInsert: charm }, { upsert: true });
    if (res.upsertedCount) created.push(charm.slug);
  }
  return { created };
}

module.exports = { ensureDefaultCharms, DEFAULT_CHARMS };
