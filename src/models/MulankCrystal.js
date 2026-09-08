const mongoose = require('mongoose');

const mulankCrystalSchema = new mongoose.Schema(
  {
    number: { type: Number, required: true, min: 1, max: 9, unique: true },
    beadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Bead', required: true },
    reason: { type: String, required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('MulankCrystal', mulankCrystalSchema);
