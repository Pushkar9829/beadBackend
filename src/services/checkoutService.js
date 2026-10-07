const StoreSettings = require('../models/StoreSettings');
const Pincode = require('../models/Pincode');
const mongoose = require('mongoose');
const Product = require('../models/Product');
const { loadStudioConfig, repriceCustomSnapshot } = require('./pricingService');
const { findUsableCoupon, validateCoupon, computeDiscount } = require('./couponService');
const { getSalePriceMap, applySaleToProduct } = require('./flashSaleService');
const { bestOffer } = require('./offerService');
const { publicConfig } = require('./cashfreeService');
const ithink = require('./ithinkService');

const SETTINGS_DEFAULTS = {
  key: 'store',
  storeName: 'Kuberstones',
  payment: { cod: true, upi: true, gateway: 'Cashfree', gatewayKeyId: '', upiId: '', cashfreeEnabled: true, cashfreeAppId: '', cashfreeSecret: '', cashfreeEnv: 'sandbox' },
  shipping: { fee: 0, freeThreshold: 999, estimatedDays: 5, ithinkEnabled: true },
  tax: { gstPercent: 0 },
};

async function getSettings() {
  const stored = await StoreSettings.findOne({ key: 'store' }).lean();
  return {
    ...SETTINGS_DEFAULTS,
    ...stored,
    payment: { ...SETTINGS_DEFAULTS.payment, ...stored?.payment },
    shipping: { ...SETTINGS_DEFAULTS.shipping, ...stored?.shipping },
    tax: { ...SETTINGS_DEFAULTS.tax, ...stored?.tax },
  };
}

async function checkPincode(code) {
  const raw = typeof code === 'string' || typeof code === 'number' ? String(code).trim() : '';
  // No pincode yet (bag preview) → nothing to check; order creation always supplies one.
  if (!raw) return { serviceable: true, extraFee: 0, estimatedDays: 5, found: false, cod: true };
  const pincode = raw.replace(/\D/g, '');
  if (!/^\d{6}$/.test(pincode)) {
    return { serviceable: false, extraFee: 0, estimatedDays: 5, found: false, cod: false, invalid: true };
  }
  const row = await Pincode.findOne({ pincode }).lean();
  if (row && row.serviceable === false) {
    return {
      serviceable: false,
      extraFee: row.extraFee || 0,
      estimatedDays: row.estimatedDays || 5,
      city: row.city,
      state: row.state,
      found: true,
      cod: false,
      source: 'local',
    };
  }
  const cfg = await ithink.getConfig();
  if (cfg.enabled) {
    try {
      const remote = await ithink.checkPincode(pincode);
      return {
        ...remote,
        extraFee: row?.extraFee || 0,
        estimatedDays: row?.estimatedDays || remote.estimatedDays || 5,
        city: remote.city || row?.city,
        state: remote.state || row?.state,
      };
    } catch {
      /* fall through to local / open */
    }
  }
  if (!row) return { serviceable: true, extraFee: 0, estimatedDays: 5, found: false, cod: true };
  return {
    serviceable: row.serviceable !== false,
    extraFee: row.extraFee || 0,
    estimatedDays: row.estimatedDays || 5,
    city: row.city,
    state: row.state,
    found: true,
    cod: true,
    source: 'local',
  };
}

const MAX_LINE_QTY = 99;

function lineQty(item) {
  const n = Number(item.quantity ?? 1);
  return Number.isInteger(n) && n >= 1 && n <= MAX_LINE_QTY ? n : null;
}

async function quote({ items, couponCode, user, pincode }) {
  const settings = await getSettings();
  const cashfree = await publicConfig();
  const saleMap = await getSalePriceMap();
  const productIds = items
    .filter((i) => i.kind === 'product' && mongoose.isObjectIdOrHexString(i.productId))
    .map((i) => i.productId);
  const products = productIds.length
    ? await Product.find({ _id: { $in: productIds } }).lean()
    : [];
  const byId = Object.fromEntries(products.map((p) => [String(p._id), p]));
  const hasCustom = items.some((i) => i.kind === 'custom_bracelet');
  const studioConfig = hasCustom ? await loadStudioConfig() : null;

  // Every line is re-priced from live data; unavailable lines are reported, never charged at stale prices.
  const itemErrors = [];
  const pricedItems = [];
  for (const item of items) {
    const name = item.snapshot?.name || item.name || 'An item';
    const qty = lineQty(item);
    if (!qty) {
      itemErrors.push({ itemId: item._id, message: `${name} has an invalid quantity.` });
      continue;
    }
    if (item.kind === 'product') {
      const product = item.productId ? byId[String(item.productId)] : null;
      if (!product || product.isActive === false) {
        itemErrors.push({ itemId: item._id, message: `${name} is no longer available.` });
        continue;
      }
      const unit = Math.max(0, Number(applySaleToProduct(product, saleMap).price) || 0);
      pricedItems.push({
        ...item,
        quantity: qty,
        unitPrice: unit,
        lineTotal: unit * qty,
        categoryId: product.categoryId,
        snapshot: {
          ...(item.snapshot || {}),
          originalPrice: product.price,
          categoryId: product.categoryId,
        },
      });
    } else if (item.kind === 'custom_bracelet') {
      try {
        const { quote: pricing, finish, beads } = await repriceCustomSnapshot(item.snapshot || {}, studioConfig);
        const unit = pricing.total;
        pricedItems.push({
          ...item,
          quantity: qty,
          unitPrice: unit,
          lineTotal: unit * qty,
          snapshot: {
            ...(item.snapshot || {}),
            beads: pricing.lines.map((line, i) => ({ ...(item.snapshot?.beads?.[i] || {}), ...beads[i], ...line })),
            finish,
            pricing,
          },
        });
      } catch (err) {
        itemErrors.push({ itemId: item._id, message: `${name}: ${err.message}` });
      }
    } else {
      itemErrors.push({ itemId: item._id, message: `${name} cannot be purchased.` });
    }
  }

  const subtotal = pricedItems.reduce((s, i) => s + (i.lineTotal || 0), 0);
  let discount = 0;
  let coupon = null;
  let couponError = null;
  if (couponCode) {
    coupon = await findUsableCoupon(couponCode);
    const check = await validateCoupon({ coupon, user, items: pricedItems, subtotal });
    if (check.ok) discount = computeDiscount(coupon, subtotal, pricedItems);
    else {
      coupon = null;
      couponError = check.message;
    }
  }

  const pin = await checkPincode(pincode);
  let shippingFee = Number(settings.shipping.fee || 0) + Number(pin.extraFee || 0);
  const threshold = Number(settings.shipping.freeThreshold || 0);
  const auto = await bestOffer({ items: pricedItems, subtotal, shippingFee });
  const moneyApplied = !coupon && auto.discount > 0;
  if (moneyApplied) discount = auto.discount;
  const offer = (moneyApplied || auto.freeShipping)
    ? {
      _id: (moneyApplied ? auto.moneyOffer : auto.shippingOffer)?._id,
      name: (moneyApplied ? auto.moneyOffer?.name : auto.shippingOffer?.name) || auto.offer?.name,
      label: [moneyApplied ? auto.moneyOffer?.name : null, auto.freeShipping ? auto.shippingOffer?.name : null]
        .filter(Boolean)
        .filter((item, index, list) => list.indexOf(item) === index)
        .join(' + ') || auto.offer?.name,
      shippingName: auto.freeShipping ? auto.shippingOffer?.name : '',
      type: moneyApplied ? auto.moneyOffer?.type : 'free_shipping',
      discount: moneyApplied ? auto.discount : 0,
      freeShipping: Boolean(auto.freeShipping),
    }
    : null;

  const afterDiscount = Math.max(0, subtotal - discount);
  if (threshold > 0 && afterDiscount >= threshold) shippingFee = 0;
  if (auto.freeShipping) shippingFee = 0;
  if (!pin.serviceable) shippingFee = 0;

  const gst = Number(settings.tax.gstPercent || 0);
  const tax = gst ? Math.round((afterDiscount * gst) / 100) : 0;
  const total = afterDiscount + shippingFee + tax;

  return {
    items: pricedItems,
    itemErrors,
    error: itemErrors.length ? itemErrors.map((e) => e.message).join(' ') : null,
    subtotal,
    discount,
    shippingFee,
    tax,
    total,
    gstPercent: gst,
    coupon: coupon
      ? { _id: coupon._id, code: coupon.code, type: coupon.type, value: coupon.value, discount }
      : null,
    couponError,
    offer,
    pincode: pin,
    payment: {
      cod: Boolean(settings.payment.cod) && pin.serviceable !== false && pin.cod !== false,
      upi: Boolean(settings.payment.upi),
      gateway: Boolean(cashfree.enabled),
      gatewayName: cashfree.enabled ? 'Cashfree' : '',
      upiId: settings.payment.upiId || '',
      cashfree,
    },
    settings: {
      currency: settings.currency || 'INR',
      freeThreshold: threshold,
      estimatedDays: pin.estimatedDays || settings.shipping.estimatedDays,
    },
  };
}

module.exports = { getSettings, checkPincode, quote };
