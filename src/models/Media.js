const mongoose = require('mongoose');

const mediaSchema = new mongoose.Schema(
  {
    filename: String,
    originalName: String,
    url: String,
    key: String,
    storage: { type: String, enum: ['s3', 'local', 'remote'], default: 'local' },
    mimeType: String,
    size: Number,
    folder: { type: String, default: 'other', trim: true },
    tags: [String],
  },
  { timestamps: true }
);

module.exports = mongoose.model('Media', mediaSchema);
