const mongoose = require('mongoose');

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true },
    family: { type: String, enum: ['crystals', 'rudraksha', 'gemstones'], required: true },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
    collectionIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Collection' }],
    sku: { type: String, trim: true, unique: true, sparse: true },
    images: [String],
    description: String,
    shortDescription: String,
    price: { type: Number, required: true, min: 0 },
    compareAtPrice: Number,
    stock: { type: Number, default: 0 },
    lowStockLimit: { type: Number, default: 5 },
    featured: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    colorHex: { type: String, default: '#6B3FA0' },
    attributes: { type: Map, of: String },
  },
  { timestamps: true }
);

productSchema.index({ family: 1, categoryId: 1, isActive: 1 });
productSchema.index({ featured: 1 });

module.exports = mongoose.model('Product', productSchema);
