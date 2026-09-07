const mongoose = require('mongoose');

const charmSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true },
    description: String,
    isActive: { type: Boolean, default: true },
    finishes: [
      {
        key: { type: String, required: true },
        label: { type: String, required: true },
        price: { type: Number, required: true, min: 0 },
        metalColor: { type: String, required: true },
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model('Charm', charmSchema);
