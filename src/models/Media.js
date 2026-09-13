const mongoose = require('mongoose');

const mediaSchema = new mongoose.Schema(
  {
    filename: String,
    originalName: String,
    url: String,
    mimeType: String,
    size: Number,
    folder: {
      type: String,
      enum: ['all', 'product', 'category', 'banner', 'blog', 'other'],
      default: 'other',
    },
    tags: [String],
  },
  { timestamps: true }
);

module.exports = mongoose.model('Media', mediaSchema);
