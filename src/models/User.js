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
    display: String,
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
    // Set only after the number was proven with a WhatsApp login code (E.164 digits, e.g. 919812345678).
    // `phone` above is typed by the customer and never used to sign in.
    whatsappPhone: String,
    phoneVerifiedAt: Date,
    addresses: [addressSchema],
    groupIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'CustomerGroup' }],
    tokenVersion: { type: Number, default: 0 },
    // Disabled accounts cannot sign in and their existing tokens are rejected.
    isActive: { type: Boolean, default: true },
    lastLoginAt: Date,
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
    whatsappVerified: Boolean(this.whatsappPhone && this.phoneVerifiedAt),
    addresses: this.addresses,
    groupIds: this.groupIds,
    isActive: this.isActive !== false,
    lastLoginAt: this.lastLoginAt || null,
    createdAt: this.createdAt,
  };
};

userSchema.index({ whatsappPhone: 1 }, { unique: true, partialFilterExpression: { whatsappPhone: { $type: 'string' } } });

module.exports = mongoose.model('User', userSchema);
