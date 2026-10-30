const mongoose = require('mongoose');

// Free Kundli settings that must not drift between restarts. One document (key 'main'), created the
// first time the Kundli service starts. `eligibleFrom` is the launch cutoff: only orders paid (online/UPI)
// or delivered (COD) at or after it unlock a Kundli. KUNDLI_ELIGIBLE_FROM (env) overrides it.
const kundliSettingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: 'main' },
    eligibleFrom: { type: Date, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('KundliSetting', kundliSettingSchema);
