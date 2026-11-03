const mongoose = require('mongoose');

// WhatsApp login switch (Admin -> Settings -> WhatsApp login). One document, key 'main'.
const whatsAppSettingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: 'main' },
    enabled: { type: Boolean, default: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('WhatsAppSetting', whatsAppSettingSchema);
