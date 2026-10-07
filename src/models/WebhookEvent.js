const mongoose = require('mongoose');

const webhookEventSchema = new mongoose.Schema(
  {
    provider: { type: String, enum: ['cashfree', 'ithink'], required: true },
    eventId: { type: String, default: '' },
    eventType: { type: String, default: '' },
    // processing = claimed by a worker (dedupe lock); failed = may be re-claimed by a provider retry.
    status: { type: String, enum: ['processing', 'applied', 'ignored', 'mismatch', 'failed'], default: 'applied' },
    ref: { type: String, default: '' },
    message: { type: String, default: '' },
  },
  { timestamps: true }
);

webhookEventSchema.index({ provider: 1, eventId: 1 }, { unique: true, sparse: true });
webhookEventSchema.index({ createdAt: -1 });

module.exports = mongoose.model('WebhookEvent', webhookEventSchema);
