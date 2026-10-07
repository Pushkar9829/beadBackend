const Order = require('../models/Order');
const { cancelOrder } = require('./orderLifecycleService');

function ttlMinutes(envKey, fallback) {
  const n = Number(process.env[envKey]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Cancels unpaid orders stuck in pending_payment past their TTL (restores stock, releases coupons).
 * TTLs (minutes): PENDING_ORDER_TTL_MINUTES for gateway orders (default 60),
 * PENDING_UPI_ORDER_TTL_MINUTES for UPI orders (default 1440). Safe to run on an interval.
 */
async function expireStalePendingOrders({ now = new Date(), limit = 200 } = {}) {
  const gatewayCutoff = new Date(now.getTime() - ttlMinutes('PENDING_ORDER_TTL_MINUTES', 60) * 60000);
  const upiCutoff = new Date(now.getTime() - ttlMinutes('PENDING_UPI_ORDER_TTL_MINUTES', 1440) * 60000);
  const stale = await Order.find({
    status: 'pending_payment',
    'payment.status': { $ne: 'paid' },
    $or: [
      { 'payment.method': 'upi', createdAt: { $lt: upiCutoff } },
      { 'payment.method': { $ne: 'upi' }, createdAt: { $lt: gatewayCutoff } },
    ],
  })
    .sort({ createdAt: 1 })
    .limit(limit);

  let cancelled = 0;
  for (const order of stale) {
    try {
      if (order.payment?.method === 'gateway') {
        // Last check with Cashfree so a late-but-successful payment is captured instead of cancelled.
        try {
          const cashfree = require('./cashfreeService');
          await cashfree.syncFromCashfree(order);
          const fresh = await Order.findById(order._id).lean();
          if (!fresh || fresh.status !== 'pending_payment' || fresh.payment?.status === 'paid') continue;
        } catch {
          /* gateway unreachable — fall through; late payments on cancelled orders are handled by the payment flow */
        }
      }
      const result = await cancelOrder(order, {
        note: 'Payment not received',
        by: 'system',
        fromStatuses: ['pending_payment'],
        requireUnpaid: true,
      });
      if (result?.status === 'cancelled') cancelled += 1;
    } catch (err) {
      console.error(`[orders] could not expire ${order.orderNumber}:`, err.message);
    }
  }
  return { checked: stale.length, cancelled };
}

module.exports = { expireStalePendingOrders };
