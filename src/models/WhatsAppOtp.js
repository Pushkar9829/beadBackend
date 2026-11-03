const mongoose = require('mongoose');

// One WhatsApp login code. Only an HMAC of the code is stored. A code is valid until expiresAt and for
// a few wrong guesses; the record itself is kept 7 days (purgeAt, TTL) for rate limits, delivery status
// (from the Meta webhook) and the admin stats.
const whatsAppOtpSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true }, // E.164 digits without "+", e.g. 919812345678
    codeHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    usedAt: Date,
    ip: String,
    messageId: String, // wamid from Meta
    // sent (accepted by Meta) -> delivered -> read, or failed; send_failed when Meta refused the request.
    status: { type: String, enum: ['sent', 'delivered', 'read', 'failed', 'send_failed'], default: 'sent' },
    error: String,
    purgeAt: { type: Date, required: true },
  },
  { timestamps: true }
);

whatsAppOtpSchema.index({ phone: 1, createdAt: -1 });
whatsAppOtpSchema.index({ messageId: 1 }, { sparse: true });
whatsAppOtpSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('WhatsAppOtp', whatsAppOtpSchema);
