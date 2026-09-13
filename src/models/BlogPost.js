const mongoose = require('mongoose');
const seoFields = require('./seoFields');

const blogPostSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true },
    excerpt: String,
    body: String,
    image: String,
    author: { type: String, default: 'Kuberstones' },
    isPublished: { type: Boolean, default: false },
    publishedAt: Date,
    seo: seoFields,
  },
  { timestamps: true }
);

blogPostSchema.index({ isPublished: 1, publishedAt: -1 });

module.exports = mongoose.model('BlogPost', blogPostSchema);
