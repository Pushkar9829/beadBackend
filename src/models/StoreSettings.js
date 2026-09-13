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
      cod: { type: Boolean, default: true },
      upi: { type: Boolean, default: true },
      gateway: { type: String, default: 'Cashfree' },
      gatewayKeyId: { type: String, default: '' },
      upiId: { type: String, default: '' },
      cashfreeEnabled: { type: Boolean, default: true },
      cashfreeAppId: { type: String, default: '' },
      cashfreeSecret: { type: String, default: '' },
      cashfreeEnv: { type: String, enum: ['sandbox', 'production'], default: 'sandbox' },
    },
    shipping: {
      fee: { type: Number, default: 0 },
      freeThreshold: { type: Number, default: 999 },
      estimatedDays: { type: Number, default: 5 },
      ithinkEnabled: { type: Boolean, default: true },
      ithinkEnv: { type: String, enum: ['production', 'staging'], default: 'production' },
      ithinkAccessToken: { type: String, default: '' },
      ithinkSecretKey: { type: String, default: '' },
      ithinkPickupAddressId: { type: String, default: '' },
      ithinkReturnAddressId: { type: String, default: '' },
      ithinkLogistics: { type: String, default: 'delhivery' },
      ithinkServiceType: { type: String, default: '' },
      ithinkWebhookSecret: { type: String, default: '' },
      defaultLengthCm: { type: Number, default: 10 },
      defaultWidthCm: { type: Number, default: 10 },
      defaultHeightCm: { type: Number, default: 5 },
      defaultWeightGrams: { type: Number, default: 400 },
    },
    tax: {
      gstPercent: { type: Number, default: 0 },
    },
    notifications: {
      email: { type: Boolean, default: true },
      sms: { type: Boolean, default: false },
      whatsapp: { type: Boolean, default: false },
    },
    seo: {
      title: { type: String, default: 'Kuberstones' },
      description: String,
      keywords: String,
      ogImage: String,
      noIndex: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('StoreSettings', storeSettingsSchema);
