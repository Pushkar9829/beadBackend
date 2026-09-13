const mongoose = require('mongoose');

const stockAdjustmentSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ['product', 'bead'], default: 'product' },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    beadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Bead' },
    delta: { type: Number, required: true },
    reason: { type: String, required: true },
    previousStock: { type: Number, required: true },
    nextStock: { type: Number, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

stockAdjustmentSchema.index({ productId: 1, createdAt: -1 });
stockAdjustmentSchema.index({ beadId: 1, createdAt: -1 });

module.exports = mongoose.model('StockAdjustment', stockAdjustmentSchema);
