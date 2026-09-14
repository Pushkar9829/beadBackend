function hashReviewCount(id) {
  const s = String(id || '');
  let n = 0;
  for (let i = 0; i < s.length; i += 1) n = (n + s.charCodeAt(i) * (i + 3)) % 180;
  return 18 + n;
}

function attachProductRating(product) {
  if (!product) return product;
  const raw = Number(product.rating);
  const rating = Number.isFinite(raw) ? Math.round(Math.min(5, Math.max(0, raw)) * 10) / 10 : 5;
  const hasCount = product.reviewCount != null && product.reviewCount !== '';
  const countRaw = Number(product.reviewCount);
  const reviewCount = hasCount && Number.isFinite(countRaw)
    ? Math.max(0, Math.round(countRaw))
    : hashReviewCount(product._id);
  return { ...product, rating, reviewCount };
}

module.exports = { attachProductRating };
