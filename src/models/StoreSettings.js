const mongoose = require('mongoose');

const storeSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: 'store' },
    storeName: { type: String, default: 'Kuberstones' },
    logo: String,
    email: { type: String, default: 'hello@kuberstones.com' },
    phone: String,
    currency: { type: String, default: 'INR' },
    payment: {
      cod: { type: Boolean, default: false },
      upi: { type: Boolean, default: false },
      gateway: { type: String, default: '' },
    },
    shipping: {
      fee: { type: Number, default: 0 },
      freeThreshold: { type: Number, default: 999 },
    },
    tax: {
      gstPercent: { type: Number, default: 0 },
    },
    notifications: {
      email: { type: Boolean, default: true },
      sms: { type: Boolean, default: false },
      whatsapp: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('StoreSettings', storeSettingsSchema);
