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
    discount: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    shippingFee: { type: Number, default: 0 },
    total: { type: Number, required: true },
    couponCode: String,
    couponId: { type: mongoose.Schema.Types.ObjectId, ref: 'Coupon' },
    shippingAddress: { type: mongoose.Schema.Types.Mixed, required: true },
    status: {
      type: String,
      enum: ['pending_payment', 'paid', 'processing', 'packed', 'shipped', 'delivered', 'cancelled', 'returned'],
      default: 'pending_payment',
    },
    payment: {
      method: { type: String, enum: ['cod', 'upi', 'gateway', null], default: null },
      gateway: { type: String, default: null },
      gatewayRef: { type: String, default: null },
      upiRef: { type: String, default: null },
      status: { type: String, enum: ['pending', 'paid', 'failed', 'refunded'], default: 'pending' },
      capturedAt: Date,
      fulfilledAt: Date,
      sessionId: String,
      cfOrderId: String,
      cfNumericId: String,
      refundId: String,
    },
    shipment: {
      provider: { type: String, default: null },
      carrier: { type: String, default: null },
      waybill: { type: String, default: null },
      trackingUrl: { type: String, default: null },
      orderType: { type: String, default: 'forward' },
      bookedAt: Date,
      lastTrackedAt: Date,
      lastStatus: { type: String, default: null },
      expectedDelivery: { type: String, default: null },
      returnWaybill: { type: String, default: null },
      returnTrackingUrl: { type: String, default: null },
      returnStatus: { type: String, default: null },
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
