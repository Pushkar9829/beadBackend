const Offer = require('../models/Offer');

function eligibleItems(items, offer) {
  const productIds = (offer.productIds || []).map((id) => String(id));
  const categoryId = offer.categoryId ? String(offer.categoryId) : '';
  return (items || []).filter((item) => {
    if (item.kind === 'custom_bracelet') return !productIds.length && !categoryId;
    const pid = String(item.productId || '');
    const cat = String(item.snapshot?.categoryId || item.product?.categoryId || '');
    if (productIds.length) return productIds.includes(pid);
    if (categoryId) return cat === categoryId;
    return true;
  });
}

function bogoDiscount(items, buyQty, getQty) {
  const buy = Math.max(1, Number(buyQty) || 1);
  const get = Math.max(1, Number(getQty) || 1);
  const units = [];
  items.forEach((item) => {
    const qty = Number(item.quantity) || 1;
    for (let i = 0; i < qty; i += 1) units.push(Number(item.unitPrice) || 0);
  });
  if (!units.length) return 0;
  units.sort((a, b) => a - b);
  const freeCount = Math.floor(units.length / (buy + get)) * get;
  return units.slice(0, freeCount).reduce((sum, price) => sum + price, 0);
}

function computeOffer(offer, items, subtotal) {
  const eligible = eligibleItems(items, offer);
  const eligibleTotal = eligible.reduce((sum, item) => sum + (Number(item.lineTotal) || 0), 0);
  const minOrder = Number(offer.minOrder) || 0;
  if (minOrder > 0 && subtotal < minOrder) {
    return { discount: 0, freeShipping: false };
  }
  if (offer.type === 'percent') {
    const percent = Math.max(0, Number(offer.percent) || 0);
    return { discount: Math.round((eligibleTotal * percent) / 100), freeShipping: false };
  }
  if (offer.type === 'fixed') {
    const amount = Math.max(0, Number(offer.amountOff) || 0);
    return { discount: Math.min(amount, eligibleTotal), freeShipping: false };
  }
  if (offer.type === 'free_shipping') {
    return { discount: 0, freeShipping: true };
  }
  if (offer.type === 'bogo') {
    return { discount: bogoDiscount(eligible, offer.buyQty, offer.getQty), freeShipping: false };
  }
  if (offer.type === 'bundle') {
    if (offer.percent) {
      return { discount: Math.round((eligibleTotal * Number(offer.percent)) / 100), freeShipping: false };
    }
    const amount = Math.max(0, Number(offer.amountOff) || 0);
    return { discount: Math.min(amount, eligibleTotal), freeShipping: false };
  }
  return { discount: 0, freeShipping: false };
}

function publicOffer(offer, extra = {}) {
  if (!offer) return null;
  return {
    _id: offer._id,
    name: offer.name,
    type: offer.type,
    ...extra,
  };
}

async function bestOffer({ items, subtotal, shippingFee = 0 }) {
  const offers = await Offer.find({ isActive: true }).lean();
  let money = { discount: 0, offer: null };
  let ship = { offer: null };
  offers.forEach((offer) => {
    const result = computeOffer(offer, items, subtotal);
    if (result.freeShipping) ship = { offer };
    if (result.discount > money.discount) money = { discount: result.discount, offer };
  });
  const freeShipping = Boolean(ship.offer);
  if (!money.offer && !freeShipping) {
    return { discount: 0, freeShipping: false, moneyOffer: null, shippingOffer: null, offer: null };
  }
  const moneyOffer = publicOffer(money.offer, { discount: money.discount, freeShipping: false });
  const shippingOffer = publicOffer(ship.offer, { discount: 0, freeShipping: true });
  const names = [moneyOffer?.name, shippingOffer && String(shippingOffer._id) !== String(moneyOffer?._id) ? shippingOffer.name : null]
    .filter(Boolean);
  return {
    discount: money.discount,
    freeShipping,
    moneyOffer,
    shippingOffer,
    offer: {
      _id: (moneyOffer || shippingOffer)._id,
      name: names.join(' + '),
      type: (moneyOffer || shippingOffer).type,
      discount: money.discount,
      freeShipping,
      shippingValue: freeShipping ? Number(shippingFee) || 0 : 0,
    },
  };
}

module.exports = { bestOffer, computeOffer };
