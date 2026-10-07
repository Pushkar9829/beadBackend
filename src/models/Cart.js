const mongoose = require('mongoose');

const cartItemSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ['product', 'custom_bracelet'], required: true },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    quantity: {
      type: Number,
      default: 1,
      min: 1,
      max: 99,
      validate: { validator: Number.isInteger, message: 'Quantity must be a whole number.' },
    },
    snapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
    unitPrice: { type: Number, required: true, min: 0 },
    lineTotal: { type: Number, required: true, min: 0 },
  },
  { _id: true, timestamps: true }
);

const cartSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', unique: true, sparse: true },
    items: [cartItemSchema],
    couponCode: { type: String, default: '', maxlength: 40 },
    remindedAt: Date,
  },
  { timestamps: true }
);

module.exports = mongoose.model('Cart', cartSchema);
