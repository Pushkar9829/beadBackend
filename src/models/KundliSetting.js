const mongoose = require('mongoose');

// Free Kundli settings that must not drift between restarts. One document (key 'main'), created the
// first time the Kundli service starts. `eligibleFrom` is the launch cutoff: only orders paid (online/UPI)
// or delivered (COD) at or after it unlock a Kundli. KUNDLI_ELIGIBLE_FROM (env) overrides it.
// The rest is edited in Admin -> Sales -> Kundli -> Settings. Unset caps fall back to the env/defaults.
const kundliSettingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: 'main' },
    eligibleFrom: { type: Date, required: true },
    // false pauses customer/system generation: Kundlis wait 'on_hold' until it is switched back on.
    enabled: { type: Boolean, default: true },
    // Runs (each spends the calls of the included parts) per IST day / week (Mon-Sun) / month; null = no limit.
    limits: {
      day: { type: Number, default: null },
      week: { type: Number, default: null },
      month: { type: Number, default: null },
    },
    // Parts of the Kundli that are requested from AstrologyAPI (one call each); a missing key means on.
    sections: { type: mongoose.Schema.Types.Mixed, default: {} },
    customerRegenCap: { type: Number, default: null },
    customerRetryCap: { type: Number, default: null },
    placesDailyCap: { type: Number, default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('KundliSetting', kundliSettingSchema);
