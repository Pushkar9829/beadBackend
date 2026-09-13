const mongoose = require('mongoose');

const addressSchema = new mongoose.Schema(
  {
    label: { type: String, default: 'Home' },
    line1: { type: String, required: true },
    line2: String,
    city: { type: String, required: true },
    state: { type: String, required: true },
    pincode: { type: String, required: true },
    country: { type: String, default: 'India' },
    phone: String,
    isDefault: { type: Boolean, default: false },
    lat: Number,
    lng: Number,
    source: { type: String, enum: ['manual', 'gps'], default: 'manual' },
  },
  { _id: true }
);

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['customer', 'admin', 'manager', 'staff'], default: 'customer' },
    permissions: { type: [String], default: [] },
    phone: String,
    addresses: [addressSchema],
    groupIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'CustomerGroup' }],
  },
  { timestamps: true }
);

userSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id,
    name: this.name,
    email: this.email,
    role: this.role,
    permissions: this.permissions || [],
    phone: this.phone,
    addresses: this.addresses,
    groupIds: this.groupIds,
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model('User', userSchema);
