const ELIGIBLE_REASONS = {
  wrong_product: 'Wrong product received',
  damaged_in_transit: 'Product materially damaged in transit',
  missing_item: 'Missing product or material part of the order',
  not_as_described: 'Product materially different from the description or order',
  defect: 'Eligible defect or issue covered by applicable law',
};

const CHANGE_OF_MIND = 'change_of_mind';

function isPersonalizedItem(item) {
  if (!item) return false;
  if (item.kind === 'custom_bracelet') return true;
  const snap = item.snapshot || {};
  return Boolean(
    snap.mulank ||
    snap.zodiac ||
    snap.engravingName ||
    snap.custom ||
    snap.purpose ||
    snap.intention
  );
}

function orderHasPersonalized(order) {
  return (order?.items || []).some(isPersonalizedItem);
}

function prepStarted(order) {
  return ['processing', 'packed', 'shipped', 'delivered', 'returned'].includes(order?.status);
}

function evaluateRequest({ order, type = 'return', reasonCode }) {
  const kind = type === 'exchange' ? 'exchange' : 'return';
  if (!order) return { ok: false, message: 'Order not found.' };
  if (!['shipped', 'delivered'].includes(order.status)) {
    return { ok: false, message: `${kind === 'exchange' ? 'Exchanges' : 'Returns'} can be requested after the order is shipped or delivered.` };
  }

  const personalized = orderHasPersonalized(order);
  const eligible = Boolean(ELIGIBLE_REASONS[reasonCode]);
  const changeOfMind = reasonCode === CHANGE_OF_MIND || !reasonCode || reasonCode === 'other';

  if (personalized && prepStarted(order) && (changeOfMind || !eligible)) {
    return {
      ok: false,
      personalized,
      eligible: false,
      message:
        kind === 'exchange'
          ? 'Customized, personalized, prepared or energized products are generally not eligible for exchange due to change of mind once preparation has started.'
          : 'Change-of-mind returns are not available for personalized or customized pieces once preparation has started.',
    };
  }

  if (!eligible && !changeOfMind) {
    return { ok: false, personalized, eligible: false, message: 'Choose a valid reason so we can review the request.' };
  }

  return {
    ok: true,
    personalized,
    eligible: eligible || !personalized,
    reasonLabel: ELIGIBLE_REASONS[reasonCode] || 'Change of mind / preference',
  };
}

module.exports = {
  ELIGIBLE_REASONS,
  CHANGE_OF_MIND,
  isPersonalizedItem,
  orderHasPersonalized,
  evaluateRequest,
};
