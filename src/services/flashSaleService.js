const FlashSale = require('../models/FlashSale');

function saleWindowMatch(now = new Date()) {
  return {
    isActive: true,
    startsAt: { $lte: now },
    endsAt: { $gte: now },
  };
}

async function getActiveSales(now = new Date()) {
  return FlashSale.find(saleWindowMatch(now)).populate('items.productId', 'name slug price images shortDescription family colorHex compareAtPrice isActive').lean();
}

async function getSalePriceMap(now = new Date()) {
  const sales = await FlashSale.find(saleWindowMatch(now)).lean();
  const map = new Map();
  for (const sale of sales) {
    for (const item of sale.items || []) {
      const id = String(item.productId);
      if (!map.has(id)) map.set(id, { sale, item });
    }
  }
  return map;
}

function computeSalePrice(basePrice, item) {
  if (!item) return null;
  if (item.salePrice != null && Number.isFinite(Number(item.salePrice))) {
    return Math.max(0, Number(item.salePrice));
  }
  if (item.percent != null && Number.isFinite(Number(item.percent))) {
    return Math.max(0, Math.round(basePrice * (1 - Number(item.percent) / 100)));
  }
  return null;
}

function applySaleToProduct(product, saleMap) {
  if (!product) return product;
  const hit = saleMap.get(String(product._id));
  if (!hit) return product;
  const salePrice = computeSalePrice(product.price, hit.item);
  if (salePrice == null || salePrice >= product.price) return product;
  return {
    ...product,
    compareAtPrice: product.compareAtPrice || product.price,
    price: salePrice,
    originalPrice: product.price,
    flashSale: {
      id: hit.sale._id,
      name: hit.sale.name,
      endsAt: hit.sale.endsAt,
    },
  };
}

async function recordFlashSaleOrder(order) {
  const now = new Date(order.createdAt || Date.now());
  const sales = await FlashSale.find(saleWindowMatch(now));
  if (!sales.length) return;
  for (const sale of sales) {
    const ids = new Set((sale.items || []).map((i) => String(i.productId)));
    let units = 0;
    let revenue = 0;
    let discount = 0;
    for (const line of order.items || []) {
      const pid = line.productId ? String(line.productId) : '';
      if (!ids.has(pid)) continue;
      const qty = line.quantity || 1;
      units += qty;
      revenue += line.lineTotal || 0;
      const original = (line.snapshot?.originalPrice || line.snapshot?.compareAtPrice || 0) * qty;
      if (original > (line.lineTotal || 0)) discount += original - (line.lineTotal || 0);
    }
    if (!units) continue;
    sale.unitsSold = (sale.unitsSold || 0) + units;
    sale.revenue = (sale.revenue || 0) + revenue;
    sale.discountCost = (sale.discountCost || 0) + discount;
    await sale.save();
  }
}

module.exports = {
  getActiveSales,
  getSalePriceMap,
  computeSalePrice,
  applySaleToProduct,
  recordFlashSaleOrder,
};
