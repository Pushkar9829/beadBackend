const StoreSettings = require('../models/StoreSettings');
const Pincode = require('../models/Pincode');
const Product = require('../models/Product');
const { findUsableCoupon, validateCoupon, computeDiscount } = require('./couponService');
const { getSalePriceMap, applySaleToProduct } = require('./flashSaleService');
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
  const pincode = String(code || '').trim();
  if (!pincode) return { serviceable: true, extraFee: 0, estimatedDays: 5, found: false, cod: true };
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
  if (cfg.enabled && /^\d{6}$/.test(pincode)) {
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

function lineUnitPrice(item, saleMap) {
  if (item.kind === 'custom_bracelet') return item.unitPrice;
  if (item.product && saleMap) {
    const priced = applySaleToProduct(item.product, saleMap);
    return priced.price;
  }
  return item.unitPrice;
}

async function quote({ items, couponCode, user, pincode }) {
  const settings = await getSettings();
  const cashfree = await publicConfig();
  const saleMap = await getSalePriceMap();
  const productIds = items.filter((i) => i.kind === 'product' && i.productId).map((i) => i.productId);
  const products = productIds.length
    ? await Product.find({ _id: { $in: productIds } }).lean()
    : [];
  const byId = Object.fromEntries(products.map((p) => [String(p._id), p]));

  const pricedItems = items.map((item) => {
    const product = item.productId ? byId[String(item.productId)] : null;
    const unit = lineUnitPrice({ ...item, product }, saleMap);
    const qty = item.quantity || 1;
    return {
      ...item,
      unitPrice: unit,
      lineTotal: unit * qty,
      snapshot: {
        ...(item.snapshot || {}),
        originalPrice: product?.price,
        categoryId: product?.categoryId,
      },
    };
  });

  const subtotal = pricedItems.reduce((s, i) => s + (i.lineTotal || 0), 0);
  let discount = 0;
  let coupon = null;
  let couponError = null;
  if (couponCode) {
    coupon = await findUsableCoupon(couponCode);
    const check = await validateCoupon({ coupon, user, items: pricedItems, subtotal });
    if (check.ok) discount = computeDiscount(coupon, subtotal);
    else {
      coupon = null;
      couponError = check.message;
    }
  }

  const afterDiscount = Math.max(0, subtotal - discount);
  const pin = await checkPincode(pincode);
  let shippingFee = Number(settings.shipping.fee || 0) + Number(pin.extraFee || 0);
  const threshold = Number(settings.shipping.freeThreshold || 0);
  if (threshold > 0 && afterDiscount >= threshold) shippingFee = 0;
  if (!pin.serviceable) shippingFee = 0;

  const gst = Number(settings.tax.gstPercent || 0);
  const tax = gst ? Math.round((afterDiscount * gst) / 100) : 0;
  const total = afterDiscount + shippingFee + tax;

  return {
    items: pricedItems,
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
