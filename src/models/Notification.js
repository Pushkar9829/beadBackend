const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: [
        'new_order',
        'low_stock',
        'out_of_stock',
        'payment_failed',
        'new_customer',
        'abandoned_cart',
        'return',
        'contact',
        'system',
      ],
      default: 'system',
    },
    title: { type: String, required: true },
    body: String,
    link: String,
    read: { type: Boolean, default: false },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
    channels: { type: [String], default: [] },
  },
  { timestamps: true }
);

notificationSchema.index({ read: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
