const mongoose = require('mongoose');

const webhookEventSchema = new mongoose.Schema(
  {
    provider: { type: String, enum: ['cashfree', 'ithink'], required: true },
    eventId: { type: String, default: '' },
    eventType: { type: String, default: '' },
    status: { type: String, enum: ['applied', 'ignored', 'failed'], default: 'applied' },
    ref: { type: String, default: '' },
    message: { type: String, default: '' },
  },
  { timestamps: true }
);

webhookEventSchema.index({ provider: 1, eventId: 1 }, { unique: true, sparse: true });
webhookEventSchema.index({ createdAt: -1 });

module.exports = mongoose.model('WebhookEvent', webhookEventSchema);
