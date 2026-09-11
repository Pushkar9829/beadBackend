const mongoose = require('mongoose');

const beadSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true },
    image: String,
    images: [String],
    shortDescriptor: String,
    powerUse: String,
    benefits: [String],
    chakra: String,
    careNotes: String,
    disclaimer: {
      type: String,
      default:
        'These are traditional and spiritual associations, not medical claims. Kuberstones products are not intended to diagnose, treat, or cure any condition.',
    },
    origin: String,
    sizeMm: Number,
    shape: String,
    grade: { type: String, enum: ['natural', 'premium', 'rare'] },
    pricePerBead: { type: Number, required: true, min: 0 },
    stock: { type: Number, default: 100 },
    lowStockLimit: { type: Number, default: 10 },
    textureUrl: String,
    colorHex: { type: String, default: '#C6A75E' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Bead', beadSchema);
