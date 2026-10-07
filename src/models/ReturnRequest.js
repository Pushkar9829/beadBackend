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
        lineIndex: Number,
        quantity: {
          type: Number,
          default: 1,
          min: 1,
          validate: { validator: Number.isInteger, message: 'Quantity must be a whole number.' },
        },
        amount: { type: Number, default: 0, min: 0 },
      },
    ],
    refundAmount: { type: Number, default: 0, min: 0 },
    refundId: String,
    restockedAt: Date,
    // Set to the orderId while the request is open; a unique index allows one open request per order.
    openKey: { type: String, default: undefined },
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

const OPEN_STATUSES = ['requested', 'approved'];

returnRequestSchema.pre('validate', function setOpenKey() {
  this.openKey = OPEN_STATUSES.includes(this.status) ? String(this.orderId) : undefined;
});

returnRequestSchema.index({ openKey: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('ReturnRequest', returnRequestSchema);
