const IntentionBead = require('../models/IntentionBead');
const Bead = require('../models/Bead');

async function getRecommendedBeads(intentionId) {
  const links = await IntentionBead.find({ intentionId }).sort({ sortOrder: 1 }).lean();
  const beadIds = links.map((l) => l.beadId);
  const beads = await Bead.find({ _id: { $in: beadIds }, isActive: true }).lean();
  const byId = Object.fromEntries(beads.map((b) => [String(b._id), b]));

  return links
    .map((link) => {
      const bead = byId[String(link.beadId)];
      if (!bead) return null;
      return { ...bead, reason: link.reason, mappingId: link._id };
    })
    .filter(Boolean);
}

module.exports = { getRecommendedBeads };
