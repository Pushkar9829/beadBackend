const StoreSettings = require('../models/StoreSettings');

const PROD = 'https://my.ithinklogistics.com';
const STAGING = 'https://pre-alpha.ithinklogistics.com';

function indiaPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  if (digits.length === 10) return digits;
  return '';
}

function formatOrderDate(value) {
  const d = value ? new Date(value) : new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${d.getFullYear()}`;
}

function fail(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function getConfig() {
  const stored = await StoreSettings.findOne({ key: 'store' }).lean();
  const ship = stored?.shipping || {};
  const accessToken = String(ship.ithinkAccessToken || process.env.ITHINK_ACCESS_TOKEN || '').trim();
  const secretKey = String(ship.ithinkSecretKey || process.env.ITHINK_SECRET_KEY || '').trim();
  const env = String(ship.ithinkEnv || process.env.ITHINK_ENV || 'production').toLowerCase() === 'staging'
    ? 'staging'
    : 'production';
  const pickupAddressId = String(ship.ithinkPickupAddressId || process.env.ITHINK_PICKUP_ADDRESS_ID || '').trim();
  const returnAddressId = String(ship.ithinkReturnAddressId || process.env.ITHINK_RETURN_ADDRESS_ID || pickupAddressId).trim();
  return {
    enabled: ship.ithinkEnabled !== false && Boolean(accessToken && secretKey),
    accessToken,
    secretKey,
    env,
    baseUrl: env === 'staging' ? STAGING : PROD,
    pickupAddressId,
    returnAddressId,
    logistics: String(ship.ithinkLogistics || process.env.ITHINK_LOGISTICS || 'delhivery').trim(),
    serviceType: String(ship.ithinkServiceType || '').trim(),
    lengthCm: Number(ship.defaultLengthCm || 10),
    widthCm: Number(ship.defaultWidthCm || 10),
    heightCm: Number(ship.defaultHeightCm || 5),
    weightGrams: Number(ship.defaultWeightGrams || 400),
  };
}

async function publicStatus() {
  const cfg = await getConfig();
  return {
    enabled: cfg.enabled,
    env: cfg.env,
    logistics: cfg.logistics,
    pickupConfigured: Boolean(cfg.pickupAddressId),
  };
}

async function post(path, extra = {}, { baseUrl } = {}) {
  const cfg = await getConfig();
  if (!cfg.enabled) throw fail('iThink Logistics is not configured. Add access token and secret in Settings.');
  const res = await fetch(`${baseUrl || cfg.baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cache-control': 'no-cache' },
    body: JSON.stringify({
      data: {
        ...extra,
        access_token: cfg.accessToken,
        secret_key: cfg.secretKey,
      },
    }),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw fail('iThink Logistics returned an invalid response.', 502);
  }
  const status = String(json.status || '').toLowerCase();
  const code = Number(json.status_code || res.status || 0);
  const html = String(json.html_message || '').trim();
  if (['fail', 'failed', 'error'].includes(status) || (code && code !== 200 && status !== 'success')) {
    throw fail(html || json.message || 'iThink Logistics request failed.', code >= 400 ? code : 400);
  }
  const row = firstResult(json.data);
  if (row && String(row.status || '').toLowerCase() === 'fail') {
    throw fail(row.remark || html || 'iThink Logistics could not process this shipment.');
  }
  return { cfg, json, data: json.data };
}

function firstResult(data) {
  if (!data) return null;
  if (data['1']) return data[1] || data['1'];
  if (Array.isArray(data)) return data[0] || null;
  const key = Object.keys(data)[0];
  return key ? data[key] : null;
}

function yes(value) {
  return String(value || '').toUpperCase() === 'Y';
}

function addressFromOrder(order) {
  const a = order.shippingAddress || {};
  return {
    name: order.contactName || a.name || 'Customer',
    add: a.line1 || a.address || '',
    add2: a.line2 || '',
    pin: String(a.pincode || a.pin || '').replace(/\D/g, ''),
    city: a.city || '',
    state: a.state || '',
    country: a.country || 'India',
    phone: indiaPhone(order.phone || a.phone),
    email: order.email || '',
  };
}

function productsFromOrder(order) {
  const items = order.items || [];
  if (!items.length) {
    return [{
      product_name: 'Kuberstones order',
      product_sku: order.orderNumber,
      product_quantity: '1',
      product_price: String(order.total || 0),
      product_discount: '0',
    }];
  }
  return items.map((item, i) => ({
    product_name: String(item.snapshot?.name || item.name || item.kind || `Item ${i + 1}`).slice(0, 120),
    product_sku: String(item.snapshot?.sku || item.productId || `${order.orderNumber}-${i + 1}`).slice(0, 60),
    product_quantity: String(item.quantity || 1),
    product_price: String(item.unitPrice || item.lineTotal || 0),
    product_discount: '0',
  }));
}

function mapBooking(row) {
  if (!row) return null;
  const status = String(row.status || '').toLowerCase();
  if (status && status !== 'success') {
    throw fail(row.remark || row.message || 'iThink could not book this shipment.');
  }
  return {
    waybill: row.waybill || row.awb || row.awb_no || '',
    trackingUrl: row.tracking_url || (row.waybill ? `https://my.ithinklogistics.com/tracking/${row.waybill}` : ''),
    carrier: row.logistic_name || row.logistic || '',
    refnum: row.refnum || '',
    remark: row.remark || '',
  };
}

async function checkPincode(pincode) {
  const pin = String(pincode || '').replace(/\D/g, '');
  if (!/^\d{6}$/.test(pin)) {
    return { serviceable: false, found: false, extraFee: 0, estimatedDays: 5, source: 'ithink', cod: false };
  }
  const { cfg, data } = await post('/api_v3/pincode/check.json', { pincode: pin });
  const carriers = (data?.[pin] && typeof data[pin] === 'object') ? data[pin] : (data || {});
  const nested = Object.entries(carriers).filter(([, info]) => (
    info && typeof info === 'object' && (info.prepaid != null || info.cod != null || info.pickup != null)
  ));
  if (!nested.length) {
    const prepaid = yes(carriers.prepaid);
    const cod = yes(carriers.cod);
    const pickup = yes(carriers.pickup);
    if (!(carriers.prepaid || carriers.cod || carriers.pickup)) {
      return { serviceable: false, found: true, extraFee: 0, estimatedDays: 5, source: 'ithink', carriers: [], cod: false };
    }
    return {
      serviceable: prepaid || pickup,
      prepaid,
      cod,
      pickup,
      found: true,
      extraFee: 0,
      estimatedDays: 5,
      source: 'ithink',
      carriers: [],
    };
  }
  const preferred = String(cfg.logistics || '').toLowerCase();
  const match = nested.find(([name]) => name.toLowerCase() === preferred) || nested[0];
  const [, info] = match;
  const prepaid = yes(info.prepaid);
  const cod = yes(info.cod);
  const pickup = yes(info.pickup);
  return {
    serviceable: prepaid || pickup,
    prepaid,
    cod,
    pickup,
    found: true,
    extraFee: 0,
    estimatedDays: 5,
    city: info.district || info.sort_code || '',
    state: info.state_code || '',
    source: 'ithink',
    carriers: nested.map(([name, row]) => ({
      name,
      prepaid: yes(row.prepaid),
      cod: yes(row.cod),
      pickup: yes(row.pickup),
    })),
  };
}

function shipmentPayload(order, { cfg, orderType, orderNumber }) {
  const addr = addressFromOrder(order);
  if (!addr.add || !addr.pin || !addr.phone) {
    throw fail('A complete delivery address and 10-digit phone are required to book a shipment.');
  }
  if (!cfg.pickupAddressId || !cfg.returnAddressId) {
    throw fail('Set iThink pickup and return warehouse IDs in Settings.');
  }
  const prepaid = order.payment?.method !== 'cod';
  const reverse = orderType === 'reverse';
  return {
    waybill: '',
    order: orderNumber,
    sub_order: '',
    order_date: formatOrderDate(order.createdAt),
    total_amount: String(order.total || 0),
    name: addr.name,
    company_name: 'Kuberstones',
    add: addr.add,
    add2: addr.add2,
    add3: '',
    pin: addr.pin,
    city: addr.city,
    state: addr.state,
    country: addr.country,
    phone: addr.phone,
    alt_phone: '',
    email: addr.email,
    is_billing_same_as_shipping: 'yes',
    billing_name: addr.name,
    billing_company_name: 'Kuberstones',
    billing_add: addr.add,
    billing_add2: addr.add2,
    billing_add3: '',
    billing_pin: addr.pin,
    billing_city: addr.city,
    billing_state: addr.state,
    billing_country: addr.country,
    billing_phone: addr.phone,
    billing_alt_phone: '',
    billing_email: addr.email,
    products: productsFromOrder(order),
    shipment_length: String(cfg.lengthCm),
    shipment_width: String(cfg.widthCm),
    shipment_height: String(cfg.heightCm),
    weight: String(Math.max(0.1, Number(cfg.weightGrams || 400) / 1000)),
    shipping_charges: String(order.shippingFee || 0),
    giftwrap_charges: '0',
    transaction_charges: '0',
    total_discount: String(order.discount || 0),
    first_attemp_discount: '0',
    cod_charges: '0',
    advance_amount: prepaid || reverse ? String(order.total || 0) : '0',
    cod_amount: !prepaid && !reverse ? String(order.total || 0) : '0',
    payment_mode: reverse || prepaid ? 'Prepaid' : 'COD',
    reseller_name: '',
    eway_bill_number: '',
    gst_number: '',
    return_address_id: cfg.returnAddressId,
    api_source: '1',
  };
}

async function addOrder(order, { orderType = 'forward', orderNumber } = {}) {
  const cfg = await getConfig();
  if (!cfg.enabled) throw fail('iThink Logistics is not configured. Add access token and secret in Settings.');
  const ref = orderNumber || (orderType === 'reverse' ? `${order.orderNumber}-R` : order.orderNumber);
  const payload = {
    shipments: [shipmentPayload(order, { cfg, orderType, orderNumber: ref })],
    pickup_address_id: cfg.pickupAddressId,
    logistics: cfg.logistics,
    ...(cfg.serviceType ? { s_type: cfg.serviceType } : {}),
    order_type: orderType === 'reverse' ? 'reverse' : '',
  };
  const { data } = await post('/api_v3/order/add.json', payload);
  const booked = mapBooking(firstResult(data));
  if (!booked?.waybill) throw fail('iThink booked the order but did not return a waybill.');
  return { ...booked, orderType, orderNumber: ref, provider: 'ithink' };
}

async function track(awb) {
  const waybill = String(awb || '').trim();
  if (!waybill) throw fail('A waybill is required to track a shipment.');
  const cfg = await getConfig();
  let data;
  try {
    ({ data } = await post('/api_v3/order/track.json', { awb_number_list: waybill }));
  } catch (err) {
    if (cfg.env === 'production') {
      ({ data } = await post('/api_v3/order/track.json', { awb_number_list: waybill }, { baseUrl: 'https://api.ithinklogistics.com' }));
    } else {
      throw err;
    }
  }
  let row = data?.[waybill] || firstResult(data);
  if (!row && cfg.env === 'production') {
    ({ data } = await post('/api_v3/order/track.json', { awb_number_list: waybill }, { baseUrl: 'https://api.ithinklogistics.com' }));
    row = data?.[waybill] || firstResult(data);
  }
  if (!row) throw fail('No tracking data yet for this waybill.');
  return {
    waybill: row.awb_no || waybill,
    carrier: row.logistic || '',
    orderType: row.order_type || '',
    currentStatus: row.current_status || '',
    currentStatusCode: row.current_status_code || '',
    expectedDelivery: row.expected_delivery_date || '',
    lastScan: row.last_scan_details || null,
    scans: row.scan_details || [],
    returnTrackingNo: row.return_tracking_no || '',
    raw: row,
  };
}

async function cancelShipment(awb) {
  const waybill = String(awb || '').trim();
  if (!waybill) throw fail('A waybill is required to cancel a shipment.');
  const { data } = await post('/api_v3/order/cancel.json', { awb_numbers: waybill });
  return firstResult(data) || data;
}

async function listWarehouses(warehouseId) {
  const extra = warehouseId ? { warehouse_id: String(warehouseId) } : {};
  const { data } = await post('/api_v3/warehouse/get.json', extra);
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    return Object.values(data).filter((row) => row && typeof row === 'object' && (row.id || row.warehouse_id));
  }
  return [];
}

function mapStatusToOrder(currentStatus) {
  const s = String(currentStatus || '').toLowerCase();
  if (s === 'delivered') return 'delivered';
  if (s === 'rto delivered' || s === 'rev delivered') return 'returned';
  if (s.includes('cancel')) return null;
  if (s.includes('rto') || s.startsWith('rev')) return null;
  if (['picked up', 'in transit', 'reached at destination', 'out for delivery', 'undelivered', 'delayed', 'misrouted'].includes(s)) {
    return 'shipped';
  }
  return null;
}

function isReverseStatus(tracking) {
  const status = String(tracking?.currentStatus || '').toLowerCase();
  const type = String(tracking?.orderType || '').toLowerCase();
  return type === 'reverse' || status.startsWith('rev') || status.includes('rto');
}

async function applyTrackingToOrder(order, tracking, target) {
  if (!order || !tracking) return order;
  const ReturnRequest = require('../models/ReturnRequest');
  order.shipment = order.shipment || {};
  order.shipment.lastTrackedAt = new Date();
  const reverse = target === 'return' || isReverseStatus(tracking) || (tracking.waybill && tracking.waybill === order.shipment.returnWaybill);
  if (reverse) {
    order.shipment.returnStatus = tracking.currentStatus || order.shipment.returnStatus;
    if (tracking.waybill) order.shipment.returnWaybill = tracking.waybill;
    if (tracking.trackingUrl) order.shipment.returnTrackingUrl = tracking.trackingUrl;
    const next = mapStatusToOrder(tracking.currentStatus);
    if ((next === 'returned' || next === 'delivered') && order.status !== 'returned') {
      order.status = 'returned';
      order.timeline = order.timeline || [];
      order.timeline.push({ status: 'returned', note: `iThink reverse: ${tracking.currentStatus}`, at: new Date() });
    }
    if (tracking.waybill) {
      await ReturnRequest.updateMany(
        {
          $or: [
            { 'shipment.waybill': tracking.waybill },
            { orderId: order._id, status: 'approved', 'shipment.waybill': { $in: [null, '', tracking.waybill] } },
          ],
        },
        { $set: { 'shipment.lastStatus': tracking.currentStatus || '' } }
      );
    }
    return order;
  }
  order.shipment.lastStatus = tracking.currentStatus || order.shipment.lastStatus;
  order.shipment.expectedDelivery = tracking.expectedDelivery || order.shipment.expectedDelivery;
  if (tracking.carrier) order.shipment.carrier = tracking.carrier;
  if (tracking.waybill && !order.shipment.waybill) order.shipment.waybill = tracking.waybill;
  if (tracking.trackingUrl) order.shipment.trackingUrl = tracking.trackingUrl;
  const next = mapStatusToOrder(tracking.currentStatus);
  if (next && next !== order.status) {
    order.status = next;
    order.timeline = order.timeline || [];
    order.timeline.push({ status: next, note: `iThink: ${tracking.currentStatus}`, at: new Date() });
  }
  return order;
}

function formatStamp(d) {
  const x = new Date(d);
  const pad = (n) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())} ${pad(x.getHours())}:${pad(x.getMinutes())}:${pad(x.getSeconds())}`;
}

async function listChangedAwbs(from, to) {
  const start = formatStamp(from);
  const end = formatStamp(to);
  const { json, data } = await post('/api_v3/order/get_awb.json', {
    start_date_time: start,
    end_date_time: end,
  });
  const list = json['Awb list'] || json.Awb_list || data || [];
  return (Array.isArray(list) ? list : [])
    .map((row) => row.airway_bill_no || row.awb_number || row.waybill || row)
    .filter(Boolean)
    .map(String);
}

async function webhookSecret() {
  const stored = await StoreSettings.findOne({ key: 'store' }).lean();
  return String(stored?.shipping?.ithinkWebhookSecret || process.env.ITHINK_WEBHOOK_SECRET || '').trim();
}

module.exports = {
  getConfig,
  publicStatus,
  checkPincode,
  addOrder,
  track,
  cancelShipment,
  listWarehouses,
  listChangedAwbs,
  mapStatusToOrder,
  applyTrackingToOrder,
  webhookSecret,
  indiaPhone,
};
