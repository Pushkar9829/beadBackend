const mongoose = require('mongoose');

const braceletConfigSchema = new mongoose.Schema(
  {
    beadLimit: { type: Number, required: true, default: 18 },
    minBeads: { type: Number, default: 1 },
    baseMakingPrice: { type: Number, required: true, default: 499 },
    wristSizes: { type: [String], default: ['5.5"', '6"', '6.5"', '7"', '7.5"', '8"'] },
    defaultWristSize: { type: String, default: '6.5"' },
    zodiacBeadCount: { type: Number, default: 2, min: 1, max: 4 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('BraceletConfig', braceletConfigSchema);
