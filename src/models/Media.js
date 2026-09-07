const mongoose = require('mongoose');

const mediaSchema = new mongoose.Schema(
  {
    filename: String,
    originalName: String,
    url: String,
    mimeType: String,
    size: Number,
  },
  { timestamps: true }
);

module.exports = mongoose.model('Media', mediaSchema);
