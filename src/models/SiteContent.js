const mongoose = require('mongoose');

const siteContentSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    about: {
      headline: String,
      body: String,
      tagline: String,
    },
    trustClaims: [
      {
        title: String,
        body: String,
      },
    ],
    hero: {
      eyebrow: String,
      title: String,
      subtitle: String,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('SiteContent', siteContentSchema);
