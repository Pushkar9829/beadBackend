const mongoose = require('mongoose');

const intentionBeadSchema = new mongoose.Schema(
  {
    intentionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Intention', required: true },
    beadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Bead', required: true },
    reason: { type: String, required: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

intentionBeadSchema.index({ intentionId: 1, beadId: 1 }, { unique: true });

module.exports = mongoose.model('IntentionBead', intentionBeadSchema);
