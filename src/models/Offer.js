const mongoose = require('mongoose');

const offerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ['bogo', 'percent', 'free_shipping', 'fixed', 'bundle'],
      required: true,
    },
    buyQty: Number,
    getQty: Number,
    percent: Number,
    minOrder: Number,
    amountOff: Number,
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
    productIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Offer', offerSchema);
