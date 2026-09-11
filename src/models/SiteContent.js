const mongoose = require('mongoose');

const ctaSchema = new mongoose.Schema(
  {
    label: String,
    to: String,
  },
  { _id: false }
);

const houseItemSchema = new mongoose.Schema(
  {
    slug: String,
    name: String,
    roman: String,
    blurb: String,
    image: String,
    cta: String,
  },
  { _id: false }
);

const ritualStepSchema = new mongoose.Schema(
  {
    n: String,
    title: String,
    body: String,
  },
  { _id: false }
);

const claimSchema = new mongoose.Schema(
  {
    icon: String,
    title: String,
    body: String,
  },
  { _id: false }
);

const testimonialSchema = new mongoose.Schema(
  {
    quote: String,
    name: String,
    place: String,
    piece: String,
    media: String,
  },
  { _id: false }
);

const siteContentSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    hero: {
      eyebrow: String,
      brandName: String,
      title: String,
      subtitle: String,
      image: String,
      imageAlt: String,
      primaryCta: ctaSchema,
      secondaryCta: ctaSchema,
    },
    marquee: [String],
    houses: {
      eyebrow: String,
      title: String,
      body: String,
      items: [houseItemSchema],
    },
    studio: {
      eyebrow: String,
      title: String,
      body: String,
      action: String,
      to: String,
      bannerImage: String,
      kicker: String,
      heading: String,
      copy: String,
      cta: String,
    },
    ritual: {
      eyebrow: String,
      title: String,
      body: String,
      steps: [ritualStepSchema],
    },
    featured: {
      eyebrow: String,
      title: String,
      body: String,
      action: String,
      to: String,
    },
    voices: {
      eyebrow: String,
      title: String,
      body: String,
    },
    testimonials: [testimonialSchema],
    trust: {
      eyebrow: String,
      title: String,
      body: String,
    },
    trustClaims: [claimSchema],
    finale: {
      image: String,
      kicker: String,
      title: String,
      copy: String,
      primaryCta: ctaSchema,
      secondaryCta: ctaSchema,
    },
    about: {
      headline: String,
      body: String,
      tagline: String,
    },
    pages: { type: mongoose.Schema.Types.Mixed, default: {} },
    footer: { type: mongoose.Schema.Types.Mixed, default: {} },
    contact: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

module.exports = mongoose.model('SiteContent', siteContentSchema);
