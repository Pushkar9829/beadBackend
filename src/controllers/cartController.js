const mongoose = require('mongoose');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const { buildCustomSnapshot } = require('../services/pricingService');
const { asyncHandler } = require('../utils/asyncHandler');
const { quote: quoteCart } = require('../services/checkoutService');

async function getOrCreateCart(userId) {
  let cart = await Cart.findOne({ userId });
  if (!cart) cart = await Cart.create({ userId, items: [] });
  // Heal legacy lines saved before quantity validation existed so later saves don't fail.
  for (const item of cart.items) {
    const q = Math.floor(Number(item.quantity) || 1);
    if (q !== item.quantity || q < 1 || q > 99) item.quantity = Math.min(99, Math.max(1, q));
    if (!(item.unitPrice >= 0)) item.unitPrice = 0;
    item.lineTotal = item.quantity * item.unitPrice;
  }
  return cart;
}

const MAX_PRODUCT_QTY = 99;
const MAX_CART_LINES = 50;

// Positive whole quantity in 1..MAX_PRODUCT_QTY, or null when invalid.
function parseQty(value, fallback = 1) {
  const n = value === undefined || value === null || value === '' ? fallback : Number(value);
  return Number.isInteger(n) && n >= 1 && n <= MAX_PRODUCT_QTY ? n : null;
}

function productSnapshot(product) {
  return {
    name: product.name,
    slug: product.slug,
    image: product.images?.[0],
    colorHex: product.colorHex,
    family: product.family,
    categoryId: product.categoryId,
  };
}

async function findActiveProduct(id) {
  if (!mongoose.isObjectIdOrHexString(id)) return null;
  const product = await Product.findById(id);
  return product && product.isActive ? product : null;
}

// Adds/increments a product line; returns false if the merged quantity would be invalid.
function upsertProductLine(cart, product, quantity) {
  const existing = cart.items.find((i) => i.kind === 'product' && String(i.productId) === String(product._id));
  if (existing) {
    const next = Math.min(MAX_PRODUCT_QTY, existing.quantity + quantity);
    existing.quantity = next;
    existing.unitPrice = product.price;
    existing.lineTotal = next * product.price;
    existing.snapshot = { ...(existing.snapshot || {}), ...productSnapshot(product) };
    return true;
  }
  if (cart.items.length >= MAX_CART_LINES) return false;
  cart.items.push({
    kind: 'product',
    productId: product._id,
    quantity,
    unitPrice: product.price,
    lineTotal: product.price * quantity,
    snapshot: productSnapshot(product),
  });
  return true;
}

async function withQuote(cart, user, pincode) {
  const priced = await quoteCart({
    items: cart.items.map((i) => (i.toObject ? i.toObject() : i)),
    couponCode: cart.couponCode,
    user,
    pincode,
  });
  // The quote reprices every line live (flash sales, price edits); keep the saved lines in step
  // so the bag never shows one price per line and charges another.
  const live = new Map((priced.items || []).map((i) => [String(i._id), i]));
  let changed = false;
  for (const item of cart.items) {
    const p = live.get(String(item._id));
    if (!p || (p.unitPrice === item.unitPrice && p.lineTotal === item.lineTotal)) continue;
    item.unitPrice = p.unitPrice;
    item.lineTotal = p.lineTotal;
    changed = true;
  }
  if (changed) await cart.save();
  return { cart, quote: priced };
}

exports.getCart = asyncHandler(async (req, res) => {
  const cart = await getOrCreateCart(req.user._id);
  const payload = await withQuote(cart, req.user, req.query.pincode);
  res.json(payload);
});

exports.addItem = asyncHandler(async (req, res) => {
  const cart = await getOrCreateCart(req.user._id);
  const { kind } = req.body;

  if (kind === 'product') {
    const product = await findActiveProduct(req.body.productId);
    if (!product) return res.status(404).json({ message: 'Product not found.' });
    const quantity = parseQty(req.body.quantity);
    if (!quantity) return res.status(400).json({ message: `Quantity must be a whole number between 1 and ${MAX_PRODUCT_QTY}.` });
    if (!upsertProductLine(cart, product, quantity)) return res.status(400).json({ message: 'Your bag is full.' });
  } else if (kind === 'custom_bracelet') {
    if (cart.items.length >= MAX_CART_LINES) return res.status(400).json({ message: 'Your bag is full.' });
    const snapshot = await buildCustomSnapshot(req.body);
    cart.items.push({
      kind: 'custom_bracelet',
      quantity: 1,
      unitPrice: snapshot.pricing.total,
      lineTotal: snapshot.pricing.total,
      snapshot,
    });
  } else {
    return res.status(400).json({ message: 'Unknown cart item type.' });
  }

  await cart.save();
  res.json(await withQuote(cart, req.user));
});

exports.updateItem = asyncHandler(async (req, res) => {
  const cart = await getOrCreateCart(req.user._id);
  const item = mongoose.isObjectIdOrHexString(req.params.itemId) ? cart.items.id(req.params.itemId) : null;
  if (!item) return res.status(404).json({ message: 'Item not found.' });
  if (req.body.quantity !== undefined) {
    const quantity = parseQty(req.body.quantity);
    if (!quantity) return res.status(400).json({ message: `Quantity must be a whole number between 1 and ${MAX_PRODUCT_QTY}.` });
    item.quantity = quantity;
    item.lineTotal = item.quantity * item.unitPrice;
  }
  await cart.save();
  res.json(await withQuote(cart, req.user));
});

exports.removeItem = asyncHandler(async (req, res) => {
  const cart = await getOrCreateCart(req.user._id);
  cart.items = cart.items.filter((i) => String(i._id) !== req.params.itemId);
  await cart.save();
  res.json(await withQuote(cart, req.user));
});

exports.clearCart = asyncHandler(async (req, res) => {
  const cart = await getOrCreateCart(req.user._id);
  cart.items = [];
  cart.couponCode = '';
  await cart.save();
  res.json(await withQuote(cart, req.user));
});

exports.applyCoupon = asyncHandler(async (req, res) => {
  const cart = await getOrCreateCart(req.user._id);
  if (typeof req.body.code !== 'string') return res.status(400).json({ message: 'Enter a coupon code.' });
  const code = req.body.code.toUpperCase().trim().slice(0, 40);
  if (!code) return res.status(400).json({ message: 'Enter a coupon code.' });
  // Validate against the live quote (current prices + categoryId), not stored cart snapshots.
  const priced = await quoteCart({
    items: cart.items.map((i) => (i.toObject ? i.toObject() : i)),
    couponCode: code,
    user: req.user,
  });
  if (!priced.coupon) return res.status(400).json({ message: priced.couponError || 'Coupon not found.' });
  cart.couponCode = code;
  await cart.save();
  res.json(await withQuote(cart, req.user));
});

exports.removeCoupon = asyncHandler(async (req, res) => {
  const cart = await getOrCreateCart(req.user._id);
  cart.couponCode = '';
  await cart.save();
  res.json(await withQuote(cart, req.user));
});

exports.mergeCart = asyncHandler(async (req, res) => {
  const cart = await getOrCreateCart(req.user._id);
  const incoming = Array.isArray(req.body.items) ? req.body.items.slice(0, MAX_CART_LINES) : [];

  for (const raw of incoming) {
    if (!raw || typeof raw !== 'object') continue;
    if (raw.kind === 'product' && raw.productId) {
      const product = await findActiveProduct(raw.productId);
      const quantity = parseQty(raw.quantity);
      if (!product || !quantity) continue;
      upsertProductLine(cart, product, quantity);
    } else if (raw.kind === 'custom_bracelet') {
      if (cart.items.length >= MAX_CART_LINES) continue;
      try {
        // Always re-price server-side; client snapshot prices are ignored.
        const snapshot = await buildCustomSnapshot(raw);
        cart.items.push({
          kind: 'custom_bracelet',
          quantity: 1,
          unitPrice: snapshot.pricing.total,
          lineTotal: snapshot.pricing.total,
          snapshot,
        });
      } catch {
        /* skip invalid custom items */
      }
    }
  }

  await cart.save();
  res.json(await withQuote(cart, req.user));
});

exports.buildCustomSnapshot = buildCustomSnapshot;
