const mongoose = require('mongoose');

const attributeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true },
    type: { type: String, enum: ['text', 'select'], default: 'text' },
    options: [String],
    appliesTo: { type: String, enum: ['product', 'bead', 'both'], default: 'product' },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Attribute', attributeSchema);
