const Order = require('../models/Order');
const { restoreOrderStock } = require('./inventoryService');
const { releaseUsage } = require('./couponService');
const { notify } = require('./notificationService');

// Allowed forward moves for order.status. Anything else is rejected.
const TRANSITIONS = {
  pending_payment: ['paid', 'processing', 'packed', 'cancelled'],
  paid: ['processing', 'packed', 'shipped', 'cancelled'],
  processing: ['packed', 'shipped', 'cancelled'],
  packed: ['processing', 'shipped', 'cancelled'],
  shipped: ['delivered', 'returned', 'processing'], // processing = courier booking cancelled
  delivered: ['returned'],
  cancelled: [],
  returned: [],
};

function canTransition(from, to) {
  if (!to || from === to) return true;
  return (TRANSITIONS[from] || []).includes(to);
}

function assertTransition(from, to) {
  if (canTransition(from, to)) return;
  const err = new Error(`An order cannot move from "${from}" to "${to}".`);
  err.status = 400;
  throw err;
}

/**
 * Cancels an order and undoes its side effects (stock, coupon usage). Idempotent.
 * If money was captured, the order is flagged for a refund instead of silently keeping it.
 */
async function cancelOrder(order, { note = 'Order cancelled', by = 'system', fromStatuses, requireUnpaid = false } = {}) {
  const now = new Date();
  const cancellable = Object.keys(TRANSITIONS).filter((s) => TRANSITIONS[s].includes('cancelled'));
  const statuses = fromStatuses ? cancellable.filter((s) => fromStatuses.includes(s)) : cancellable;
  const claimed = await Order.findOneAndUpdate(
    {
      _id: order._id,
      status: { $in: statuses },
      ...(requireUnpaid ? { 'payment.status': { $ne: 'paid' } } : {}),
    },
    {
      $set: { status: 'cancelled' },
      $inc: { __v: 1 },
      $push: { timeline: { status: 'cancelled', note: `${note} (${by})`, at: now } },
    },
    { returnDocument: 'after' }
  );
  if (!claimed) {
    const fresh = await Order.findById(order._id);
    // Scoped cancels (e.g. expiry) quietly do nothing when the order moved on (paid meanwhile).
    if (fresh?.status === 'cancelled' || fromStatuses || requireUnpaid) return fresh;
    assertTransition(fresh?.status || order.status, 'cancelled');
    return fresh;
  }
  // Side effects are independent: one failing must not skip the other.
  for (const [label, fn] of [['stock', restoreOrderStock], ['coupon', releaseUsage]]) {
    try {
      await fn(claimed);
    } catch (err) {
      console.error(`[orders] cancel ${claimed.orderNumber}: ${label} rollback failed:`, err.message);
      await notify({
        type: 'system',
        title: `Check ${label} for cancelled order ${claimed.orderNumber}`,
        body: `Automatic ${label} rollback failed: ${err.message}`,
        link: '/admin/orders',
        meta: { orderId: claimed._id },
      }).catch(() => {});
    }
  }
  if (claimed.payment?.status === 'paid') {
    await notify({
      type: 'refund_required',
      title: `Refund needed for ${claimed.orderNumber}`,
      body: `Order was cancelled after payment of ₹${claimed.total}.`,
      link: '/admin/orders',
      meta: { orderId: claimed._id },
    });
  }
  return Order.findById(claimed._id);
}

module.exports = { TRANSITIONS, canTransition, assertTransition, cancelOrder };
