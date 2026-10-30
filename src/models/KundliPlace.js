const mongoose = require('mongoose');

// Place search (AstrologyAPI geo_details) storage, shared by every API instance and kept across restarts.
// - KundliPlaceCache: one doc per normalised query; expires through a TTL index (cached hits cost nothing).
// - KundliPlaceQuota: one doc per IST day counting new (uncached) upstream lookups, for the daily cap.

const placeCacheSchema = new mongoose.Schema(
  {
    q: { type: String, required: true, unique: true },
    places: { type: [mongoose.Schema.Types.Mixed], default: [] },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);
placeCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const placeQuotaSchema = new mongoose.Schema({
  _id: String, // IST day, YYYY-MM-DD
  count: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true },
});
placeQuotaSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const KundliPlaceCache = mongoose.model('KundliPlaceCache', placeCacheSchema);
const KundliPlaceQuota = mongoose.model('KundliPlaceQuota', placeQuotaSchema);

module.exports = { KundliPlaceCache, KundliPlaceQuota };
