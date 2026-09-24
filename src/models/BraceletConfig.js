const mongoose = require('mongoose');

const threadTypeSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    detail: { type: String, default: '' },
    icon: { type: String, default: '' },
    image: { type: String, default: '' },
  },
  { _id: false }
);

const czOptionSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    detail: { type: String, default: '' },
    icon: { type: String, default: '' },
    image: { type: String, default: '' },
    price: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const studioModeSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, trim: true, lowercase: true },
    label: { type: String, required: true, trim: true },
    short: { type: String, required: true, trim: true },
    eyebrow: { type: String, default: '' },
    title: { type: String, default: '' },
    body: { type: String, default: '' },
    chooseHint: { type: String, default: '' },
    icon: { type: String, default: '' },
    image: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { _id: false }
);

const braceletConfigSchema = new mongoose.Schema(
  {
    beadLimit: { type: Number, required: true, default: 32 },
    minBeads: { type: Number, default: 1 },
    baseMakingPrice: { type: Number, required: true, default: 0 },
    wristSizes: { type: [String], default: ['5.5"', '6"', '6.5"', '7"', '7.5"', '8"'] },
    defaultWristSize: { type: String, default: '6.5"' },
    beadSizesMm: { type: [Number], default: [6, 8, 10] },
    defaultBeadSizeMm: { type: Number, default: 8 },
    packaging: {
      box: { type: Number, default: 44 },
      clasp: { type: Number, default: 10 },
      charm: { type: Number, default: 60 },
      cz: { type: Number, default: 6 },
      roundCz: { type: Number, default: 8 },
      thread: { type: Number, default: 20 },
    },
    packagingLabels: {
      box: { type: String, default: 'Box' },
      clasp: { type: String, default: 'Clasp' },
      charm: { type: String, default: 'Charm' },
      cz: { type: String, default: 'CZ' },
      roundCz: { type: String, default: 'Round CZ' },
      thread: { type: String, default: 'Thread' },
    },
    threadTypes: { type: [threadTypeSchema], default: undefined },
    defaultThreadType: { type: String, default: 'korean-elastic' },
    czOptions: { type: [czOptionSchema], default: undefined },
    defaultCzStyle: { type: String, default: 'cz' },
    studioModes: { type: [studioModeSchema], default: undefined },
    crystalMin: { type: Number, default: 3 },
    crystalMax: { type: Number, default: 5 },
    crystalMaxNumerology: { type: Number, default: 8 },
    intentionCap: { type: Number, default: 3 },
    engravingMaxLength: { type: Number, default: 24 },
    charmRequired: { type: Boolean, default: true },
    charmHint: { type: String, default: 'Choose a charm to continue.' },
    zodiacBeadCount: { type: Number, default: 2, min: 1, max: 4 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('BraceletConfig', braceletConfigSchema);
