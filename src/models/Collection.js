const mongoose = require('mongoose');

const collectionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true },
    description: String,
    image: String,
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    ruleType: {
      type: String,
      enum: ['manual', 'bestsellers', 'new_arrivals', 'under_price', 'featured', 'trending'],
      default: 'manual',
    },
    ruleConfig: {
      maxPrice: Number,
      days: Number,
      limit: { type: Number, default: 24 },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Collection', collectionSchema);
