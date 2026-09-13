const mongoose = require('mongoose');

const flashItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    salePrice: Number,
    percent: Number,
  },
  { _id: false }
);

const flashSaleSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    items: [flashItemSchema],
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    isActive: { type: Boolean, default: true },
    revenue: { type: Number, default: 0 },
    unitsSold: { type: Number, default: 0 },
    discountCost: { type: Number, default: 0 },
  },
  { timestamps: true }
);

flashSaleSchema.index({ isActive: 1, startsAt: 1, endsAt: 1 });

module.exports = mongoose.model('FlashSale', flashSaleSchema);
