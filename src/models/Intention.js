const mongoose = require('mongoose');

const intentionSchema = new mongoose.Schema(
  {
    purposeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Purpose', required: true },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true },
    description: String,
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

intentionSchema.index({ purposeId: 1, sortOrder: 1 });

module.exports = mongoose.model('Intention', intentionSchema);
