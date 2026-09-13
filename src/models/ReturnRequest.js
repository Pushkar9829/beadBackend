const mongoose = require('mongoose');

const returnRequestSchema = new mongoose.Schema(
  {
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    type: { type: String, enum: ['return', 'exchange'], default: 'return' },
    reasonCode: { type: String, default: '' },
    reason: { type: String, required: true },
    items: [
      {
        name: String,
        productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
        quantity: { type: Number, default: 1 },
      },
    ],
    refundAmount: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['requested', 'approved', 'rejected', 'refunded', 'restocked'],
      default: 'requested',
    },
    adminNote: String,
    shipment: {
      provider: { type: String, default: null },
      waybill: { type: String, default: null },
      trackingUrl: { type: String, default: null },
      lastStatus: { type: String, default: null },
    },
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

module.exports = mongoose.model('ReturnRequest', returnRequestSchema);
