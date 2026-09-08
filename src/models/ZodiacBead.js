const mongoose = require('mongoose');

const zodiacBeadSchema = new mongoose.Schema(
  {
    sign: { type: String, required: true, unique: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true },
    fromMonth: { type: Number, required: true, min: 1, max: 12 },
    fromDay: { type: Number, required: true, min: 1, max: 31 },
    toMonth: { type: Number, required: true, min: 1, max: 12 },
    toDay: { type: Number, required: true, min: 1, max: 31 },
    beadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Bead', required: true },
    reason: { type: String, required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ZodiacBead', zodiacBeadSchema);
