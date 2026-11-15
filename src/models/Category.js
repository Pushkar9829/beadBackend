const mongoose = require('mongoose');
const seoFields = require('./seoFields');

const categorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true },
    family: {
      type: [{ type: String, enum: ['crystals', 'rudraksha', 'gemstones', 'others'] }],
      castNonArrays: true,
      required: true,
      validate: {
        validator: (value) => Array.isArray(value) && value.length > 0,
        message: 'Pick at least one family.',
      },
    },
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
    image: String,
    description: String,
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    seo: seoFields,
  },
  { timestamps: true }
);

categorySchema.index({ family: 1, parentId: 1, sortOrder: 1 });

module.exports = mongoose.model('Category', categorySchema);
