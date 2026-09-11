const mongoose = require('mongoose');

const stockAdjustmentSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    delta: { type: Number, required: true },
    reason: { type: String, required: true },
    previousStock: { type: Number, required: true },
    nextStock: { type: Number, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

stockAdjustmentSchema.index({ productId: 1, createdAt: -1 });

module.exports = mongoose.model('StockAdjustment', stockAdjustmentSchema);
