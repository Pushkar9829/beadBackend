const mongoose = require('mongoose');

// Kundli generation usage per IST period. _id: 'd:2026-11-01' (day), 'w:2026-10-26' (week, by its Monday)
// or 'm:2026-11' (month). `runs` is reserved atomically against the admin limits before a run starts;
// `calls` counts the AstrologyAPI requests those runs made (place searches are counted separately).
const kundliUsageSchema = new mongoose.Schema(
  {
    _id: String,
    runs: { type: Number, default: 0 },
    calls: { type: Number, default: 0 },
    expiresAt: Date,
  },
  { versionKey: false }
);

kundliUsageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('KundliUsage', kundliUsageSchema);
