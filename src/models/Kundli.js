const mongoose = require('mongoose');

const KUNDLI_STATUSES = ['details_needed', 'awaiting_order', 'queued', 'generating', 'ready', 'failed'];
const KUNDLI_SECTIONS = ['astro', 'planets', 'chartSvg', 'dasha', 'manglik', 'gems', 'rudraksha'];

const birthSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true },
    gender: { type: String, enum: ['male', 'female'] },
    dob: String, // YYYY-MM-DD
    tob: String, // HH:mm (12:00 when tobUnknown)
    tobUnknown: { type: Boolean, default: false },
    place: String,
    lat: Number,
    lon: Number,
    timezoneId: String,
    tzone: Number, // UTC offset in hours on the birth date, e.g. 5.5
  },
  { _id: false }
);

// One free Kundli per signed-in customer (userId). email is a copy of the account email for admin search.
const kundliSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    email: { type: String, lowercase: true, trim: true },
    birth: { type: birthSchema, default: undefined },
    language: { type: String, default: 'en' },
    status: { type: String, enum: KUNDLI_STATUSES, default: 'awaiting_order' },
    eligibleOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
    eligibleOrderNumber: String,
    eligibleAt: Date,
    // Raw AstrologyAPI responses per section (third-party shapes, rendered defensively).
    sections: {
      astro: mongoose.Schema.Types.Mixed,
      planets: mongoose.Schema.Types.Mixed,
      chartSvg: String,
      dasha: mongoose.Schema.Types.Mixed,
      manglik: mongoose.Schema.Types.Mixed,
      gems: mongoose.Schema.Types.Mixed,
      rudraksha: mongoose.Schema.Types.Mixed,
      // section key (or 'pdf') -> error message from the last run
      errors: { type: mongoose.Schema.Types.Mixed, default: {} },
    },
    pdfUrl: String,
    generatedAt: Date,
    runStartedAt: Date, // claim time of the current/last run (stale claims can be taken over)
    queuedAt: Date, // when the record last entered 'queued' (a stale queue is picked up by the sweep)
    runBy: { type: String, enum: ['system', 'customer', 'admin'] }, // who asked for the current/last run
    // Birth details the stored sections were calculated from (the current birth may differ after an edit).
    generatedBirth: { type: birthSchema, default: undefined },
    // A regeneration failed and the previous good Kundli was kept (cleared by the next good run).
    updateFailedAt: Date,
    customerRegens: { type: Number, default: 0 }, // customer-triggered regenerations of a generated Kundli (capped)
    customerRetries: { type: Number, default: 0 }, // customer retries of a failed first generation (capped)
    attempts: { type: Number, default: 0 },
    apiCalls: { type: Number, default: 0 },
    lastError: String,
  },
  { timestamps: true }
);

kundliSchema.index({ userId: 1 }, { unique: true, sparse: true });
kundliSchema.index({ status: 1 });
kundliSchema.index({ email: 1 });
kundliSchema.index({ status: 1, queuedAt: 1 });

module.exports = mongoose.model('Kundli', kundliSchema);
module.exports.KUNDLI_STATUSES = KUNDLI_STATUSES;
module.exports.KUNDLI_SECTIONS = KUNDLI_SECTIONS;
