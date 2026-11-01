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
    // Describes the image for screen readers / when it fails to load (used by the admin media library).
    alt: { type: String, trim: true, maxlength: 300, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Media', mediaSchema);
