const Bead = require('../models/Bead');
const { BEADS } = require('../data/catalogBeads');
const { catalogPriceFor } = require('../data/beadPriceSource');
const { slugifyName } = require('../utils/asyncHandler');

const DISCLAIMER =
  'These are traditional and spiritual associations, not medical claims. Kuberstones products are not intended to diagnose, treat, or cure any condition.';

// Insert-only: creates catalog beads that don't exist yet (by slug). Never touches existing beads,
// so admin edits to price, stock or copy survive restarts.
async function ensureCatalogBeads() {
  const created = [];
  for (const bead of BEADS) {
    const slug = slugifyName(bead.name);
    const res = await Bead.updateOne(
      { slug },
      {
        $setOnInsert: {
          ...bead,
          slug,
          pricePerBead: catalogPriceFor(bead.name) ?? bead.pricePerBead,
          disclaimer: DISCLAIMER,
          stock: 500,
          isActive: true,
          textureUrl: bead.image,
        },
      },
      { upsert: true }
    );
    if (res.upsertedCount) created.push(bead.name);
  }
  return { created };
}

module.exports = { ensureCatalogBeads };
