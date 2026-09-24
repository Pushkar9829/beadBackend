const mongoose = require('mongoose');

const KINDS = ['zodiac', 'numerology', 'planetary', 'profession'];

const studioLayerSchema = new mongoose.Schema(
  {
    kind: { type: String, required: true, enum: KINDS, index: true },
    slug: { type: String, required: true, lowercase: true, trim: true },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    name: { type: String, trim: true, default: '' },
    description: { type: String, trim: true, default: '' },
    image: { type: String, trim: true, default: '' },
    icon: { type: String, trim: true, default: '' },
    cardBg: { type: String, trim: true, default: '' },
    cardAccent: { type: String, trim: true, default: '' },
    hindi: { type: String, trim: true, default: '' },
    dates: { type: String, trim: true, default: '' },
    fromMonth: Number,
    fromDay: Number,
    toMonth: Number,
    toDay: Number,
    number: Number,
    theme: { type: String, trim: true, default: '' },
    suitable: { type: [String], default: [] },
    recommended: { type: [String], default: [] },
    mulank: { type: [String], default: [] },
    bhagyank: { type: [String], default: [] },
  },
  { timestamps: true }
);

studioLayerSchema.index({ kind: 1, slug: 1 }, { unique: true });
studioLayerSchema.statics.KINDS = KINDS;

const StudioLayer = mongoose.model('StudioLayer', studioLayerSchema);
StudioLayer.KINDS = KINDS;

module.exports = StudioLayer;
