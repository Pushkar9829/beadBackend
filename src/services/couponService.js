const Coupon = require('../models/Coupon');
const CouponUsage = require('../models/CouponUsage');
const Order = require('../models/Order');

function couponStatus(c, now = new Date()) {
  if (!c.isActive) return 'inactive';
  if (c.startsAt && new Date(c.startsAt) > now) return 'scheduled';
  if (c.endsAt && new Date(c.endsAt) < now) return 'expired';
  return 'active';
}

async function findUsableCoupon(code) {
  if (!code) return null;
  return Coupon.findOne({ code: String(code).toUpperCase().trim() });
}

async function validateCoupon({ coupon, user, items, subtotal }) {
  const now = new Date();
  if (!coupon) return { ok: false, message: 'Coupon not found.' };
  if (couponStatus(coupon, now) !== 'active') {
    return { ok: false, message: `This coupon is ${couponStatus(coupon, now)}.` };
  }
  if (coupon.minOrder && subtotal < coupon.minOrder) {
    return { ok: false, message: `Minimum order is ₹${coupon.minOrder}.` };
  }
  if (coupon.usageLimit != null && (coupon.usedCount || 0) >= coupon.usageLimit) {
    return { ok: false, message: 'This coupon has reached its usage limit.' };
  }
  if (user?._id) {
    const used = await CouponUsage.countDocuments({ couponId: coupon._id, userId: user._id });
    const cap = coupon.perCustomerLimit ?? 1;
    if (used >= cap) {
      return { ok: false, message: 'You have already used this coupon.' };
    }
  }
  if (coupon.audience === 'new' && user?._id) {
    const prior = await Order.countDocuments({ userId: user._id, status: { $nin: ['cancelled'] } });
    if (prior > 0) return { ok: false, message: 'This coupon is for first orders only.' };
  }
  if (coupon.audience === 'existing' && user?._id) {
    const prior = await Order.countDocuments({ userId: user._id, status: { $nin: ['cancelled'] } });
    if (prior === 0) return { ok: false, message: 'This coupon is for returning customers.' };
  }
  if (coupon.applyTo === 'category' && (coupon.categoryIds || []).length) {
    const allowed = new Set((coupon.categoryIds || []).map((id) => String(id)));
    const match = items.some((i) => allowed.has(String(i.snapshot?.categoryId || i.categoryId || '')));
    if (!match) return { ok: false, message: 'This coupon does not apply to items in your bag.' };
  }
  if (coupon.applyTo === 'products' && (coupon.productIds || []).length) {
    const allowed = new Set((coupon.productIds || []).map((id) => String(id)));
    const match = items.some((i) => allowed.has(String(i.productId || '')));
    if (!match) return { ok: false, message: 'This coupon does not apply to items in your bag.' };
  }
  return { ok: true };
}

function computeDiscount(coupon, subtotal) {
  if (!coupon) return 0;
  let discount = 0;
  if (coupon.type === 'percent') discount = Math.round((subtotal * Number(coupon.value || 0)) / 100);
  else discount = Number(coupon.value || 0);
  if (coupon.maxDiscount != null) discount = Math.min(discount, Number(coupon.maxDiscount));
  return Math.max(0, Math.min(subtotal, Math.round(discount)));
}

async function recordUsage({ coupon, user, order, discount }) {
  if (!coupon) return;
  await CouponUsage.create({
    couponId: coupon._id,
    userId: user?._id,
    orderId: order._id,
    code: coupon.code,
    discount,
    orderTotal: order.total,
  });
  coupon.usedCount = (coupon.usedCount || 0) + 1;
  coupon.revenueGenerated = (coupon.revenueGenerated || 0) + (order.total || 0);
  coupon.discountCost = (coupon.discountCost || 0) + (discount || 0);
  await coupon.save();
}

module.exports = {
  couponStatus,
  findUsableCoupon,
  validateCoupon,
  computeDiscount,
  recordUsage,
};
