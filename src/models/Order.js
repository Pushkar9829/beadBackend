const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema(
  {
    orderNumber: { type: String, required: true, unique: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    email: String,
    contactName: String,
    phone: String,
    items: { type: [mongoose.Schema.Types.Mixed], default: [] },
    subtotal: { type: Number, required: true },
    shippingFee: { type: Number, default: 0 },
    total: { type: Number, required: true },
    shippingAddress: { type: mongoose.Schema.Types.Mixed, required: true },
    status: {
      type: String,
      enum: ['pending_payment', 'paid', 'processing', 'packed', 'shipped', 'delivered', 'cancelled', 'returned'],
      default: 'pending_payment',
    },
    payment: {
      gateway: { type: String, default: null },
      gatewayRef: { type: String, default: null },
      status: { type: String, enum: ['pending', 'paid', 'failed', 'refunded'], default: 'pending' },
      capturedAt: Date,
    },
    shipment: {
      carrier: { type: String, default: null },
      waybill: { type: String, default: null },
      trackingUrl: { type: String, default: null },
    },
    notes: String,
    timeline: [
      {
        status: String,
        note: String,
        at: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model('Order', orderSchema);
