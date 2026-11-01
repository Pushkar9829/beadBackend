// One rule for "money in" across the dashboard, analytics and customer stats: an order counts once it is
// paid (online / UPI marked paid) or, for cash on delivery, delivered. Cancelled, returned and fully
// refunded orders never count.
const REVENUE_MATCH = {
  status: { $nin: ['cancelled', 'returned'] },
  'payment.status': { $ne: 'refunded' },
  $or: [{ 'payment.status': 'paid' }, { 'payment.method': 'cod', status: 'delivered' }],
};

function isRevenueOrder(order) {
  if (!order || ['cancelled', 'returned'].includes(order.status)) return false;
  const pay = order.payment || {};
  if (pay.status === 'refunded') return false;
  return pay.status === 'paid' || (pay.method === 'cod' && order.status === 'delivered');
}

module.exports = { REVENUE_MATCH, isRevenueOrder };
