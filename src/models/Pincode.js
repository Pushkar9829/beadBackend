const mongoose = require('mongoose');

const pincodeSchema = new mongoose.Schema(
  {
    pincode: { type: String, required: true, unique: true, trim: true },
    city: String,
    state: String,
    serviceable: { type: Boolean, default: true },
    extraFee: { type: Number, default: 0 },
    estimatedDays: { type: Number, default: 5 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Pincode', pincodeSchema);
