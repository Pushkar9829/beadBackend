const Attribute = require('../models/Attribute');
const Banner = require('../models/Banner');
const FlashSale = require('../models/FlashSale');
const Faq = require('../models/Faq');
const BlogPost = require('../models/BlogPost');
const Newsletter = require('../models/Newsletter');
const ContactMessage = require('../models/ContactMessage');
const CustomerGroup = require('../models/CustomerGroup');
const Pincode = require('../models/Pincode');
const Notification = require('../models/Notification');
const ReturnRequest = require('../models/ReturnRequest');
const CouponUsage = require('../models/CouponUsage');
const Product = require('../models/Product');
const Bead = require('../models/Bead');
const Order = require('../models/Order');
const User = require('../models/User');
const Cart = require('../models/Cart');
const Collection = require('../models/Collection');
const StoreSettings = require('../models/StoreSettings');
const BraceletConfig = require('../models/BraceletConfig');
const { activeStudioModes } = require('../data/studioConfigDefaults');
const mongoose = require('mongoose');
const { asyncHandler, slugifyName, cleanBody, escapeRegex, toStr, UPDATE_OPTS } = require('../utils/asyncHandler');
const { parsePage, pageMeta, parseSort } = require('../utils/pagination');
const { notify, unreadCount } = require('../services/notificationService');
const { productsForCollection, listPublicCollections, getBySlug } = require('../services/collectionService');
const { getActiveSales, getSalePriceMap, applySaleToProduct } = require('../services/flashSaleService');
const { attachProductRating } = require('../lib/productRating');
const { quote, checkPincode } = require('../services/checkoutService');
const { buildReport, parseRange, toCsv } = require('../services/analyticsService');
const { canTransition } = require('../services/orderLifecycleService');
const { listAvailableCoupons } = require('../services/couponService');
const { sectionLive } = require('../data/homeLayout');

const EXPORT_ROW_CAP = 10000;

function crud(Model, { slugFrom, omit = [] } = {}) {
  return {
    list: asyncHandler(async (req, res) => {
      const { page, limit, skip } = parsePage(req);
      const sort = parseSort(req, ['createdAt', 'name', 'sortOrder', 'title', 'question'], '-createdAt');
      const filter = {};
      const q = toStr(req.query.q, 100);
      if (q) {
        const rx = new RegExp(escapeRegex(q), 'i');
        filter.$or = [{ name: rx }, { title: rx }, { question: rx }, { email: rx }, { code: rx }];
      }
      if (req.query.isActive != null && req.query.isActive !== '') filter.isActive = req.query.isActive === 'true';
      const [rows, total] = await Promise.all([
        Model.find(filter).sort(sort).skip(skip).limit(limit).lean(),
        Model.countDocuments(filter),
      ]);
      res.json({ items: rows, pagination: pageMeta(total, page, limit) });
    }),
    save: asyncHandler(async (req, res) => {
      const data = cleanBody(req.body, { omit });
      if (slugFrom && !data.slug && data[slugFrom]) data.slug = slugifyName(data[slugFrom]);
      const doc = req.params.id
        ? await Model.findByIdAndUpdate(req.params.id, { $set: data }, UPDATE_OPTS)
        : await Model.create(data);
      if (!doc) return res.status(404).json({ message: 'Not found.' });
      res.json({ item: doc });
    }),
    remove: asyncHandler(async (req, res) => {
      await Model.findByIdAndDelete(req.params.id);
      res.json({ ok: true });
    }),
  };
}

const attributes = crud(Attribute, { slugFrom: 'name' });
const banners = crud(Banner);
const faqs = crud(Faq);
const groups = crud(CustomerGroup, { slugFrom: 'name' });
const pincodes = crud(Pincode);

exports.listAttributes = attributes.list;
exports.saveAttribute = attributes.save;
exports.removeAttribute = attributes.remove;

exports.listBanners = banners.list;
exports.saveBanner = banners.save;
exports.removeBanner = banners.remove;

exports.listFaqsAdmin = faqs.list;
exports.saveFaq = faqs.save;
exports.removeFaq = faqs.remove;

exports.listGroups = groups.list;
exports.saveGroup = groups.save;
exports.removeGroup = groups.remove;

exports.listPincodes = pincodes.list;
exports.savePincode = pincodes.save;
exports.removePincode = pincodes.remove;

exports.listFlashSales = asyncHandler(async (_req, res) => {
  const sales = await FlashSale.find().populate('items.productId', 'name sku price').sort({ createdAt: -1 }).limit(500).lean();
  const now = new Date();
  res.json({
    sales: sales.map((s) => ({
      ...s,
      live: s.isActive && s.startsAt <= now && s.endsAt >= now,
    })),
  });
});

exports.saveFlashSale = asyncHandler(async (req, res) => {
  // revenue / unitsSold / discountCost are maintained by order processing, never by the client.
  const data = cleanBody(req.body, { omit: ['revenue', 'unitsSold', 'discountCost'] });
  if (data.startsAt && data.endsAt && new Date(data.endsAt) <= new Date(data.startsAt)) {
    return res.status(400).json({ message: 'The sale must end after it starts.' });
  }
  const sale = req.params.id
    ? await FlashSale.findByIdAndUpdate(req.params.id, { $set: data }, UPDATE_OPTS)
    : await FlashSale.create(data);
  if (!sale) return res.status(404).json({ message: 'Flash sale not found.' });
  res.json({ sale });
});

exports.removeFlashSale = asyncHandler(async (req, res) => {
  await FlashSale.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

exports.flashPerformance = asyncHandler(async (req, res) => {
  const sale = await FlashSale.findById(req.params.id).populate('items.productId', 'name sku').lean();
  if (!sale) return res.status(404).json({ message: 'Flash sale not found.' });
  res.json({
    sale,
    report: {
      unitsSold: sale.unitsSold || 0,
      revenue: sale.revenue || 0,
      discountCost: sale.discountCost || 0,
    },
  });
});

exports.listBlogAdmin = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePage(req);
  const [posts, total] = await Promise.all([
    BlogPost.find().sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    BlogPost.countDocuments(),
  ]);
  res.json({ posts, pagination: pageMeta(total, page, limit) });
});

exports.saveBlog = asyncHandler(async (req, res) => {
  const data = cleanBody(req.body);
  if (!data.slug && data.title) data.slug = slugifyName(data.title);
  if (data.isPublished && !data.publishedAt) data.publishedAt = new Date();
  const post = req.params.id
    ? await BlogPost.findByIdAndUpdate(req.params.id, { $set: data }, UPDATE_OPTS)
    : await BlogPost.create(data);
  if (!post) return res.status(404).json({ message: 'Post not found.' });
  res.json({ post });
});

exports.removeBlog = asyncHandler(async (req, res) => {
  await BlogPost.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

exports.listNewsletter = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePage(req);
  const [subscribers, total] = await Promise.all([
    Newsletter.find().sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Newsletter.countDocuments(),
  ]);
  res.json({ subscribers, pagination: pageMeta(total, page, limit) });
});

exports.exportNewsletter = asyncHandler(async (_req, res) => {
  const rows = await Newsletter.find().sort({ createdAt: -1 }).limit(EXPORT_ROW_CAP).lean();
  const csv = toCsv(rows, [
    { label: 'email', value: (r) => r.email },
    { label: 'name', value: (r) => r.name || '' },
    { label: 'source', value: (r) => r.source || '' },
    { label: 'createdAt', value: (r) => r.createdAt },
  ]);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=newsletter.csv');
  res.send(csv);
});

exports.listContacts = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePage(req);
  const [messages, total] = await Promise.all([
    ContactMessage.find().sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    ContactMessage.countDocuments(),
  ]);
  res.json({ messages, pagination: pageMeta(total, page, limit) });
});

exports.listNotifications = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePage(req);
  const filter = {};
  if (req.query.unread === 'true') filter.read = false;
  const [notifications, total, unread] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Notification.countDocuments(filter),
    unreadCount(),
  ]);
  res.json({ notifications, unread, pagination: pageMeta(total, page, limit) });
});

exports.markNotificationRead = asyncHandler(async (req, res) => {
  await Notification.findByIdAndUpdate(req.params.id, { read: true });
  res.json({ ok: true, unread: await unreadCount() });
});

exports.markAllNotificationsRead = asyncHandler(async (_req, res) => {
  await Notification.updateMany({ read: false }, { read: true });
  res.json({ ok: true, unread: 0 });
});

const FEATURED_CAP = 500;

exports.featuredList = asyncHandler(async (_req, res) => {
  const products = await Product.find()
    .select('name slug sku price images featured featuredSort isActive family stock')
    .sort({ featured: -1, featuredSort: 1, name: 1 })
    .limit(FEATURED_CAP)
    .lean();
  res.json({ products });
});


exports.featuredReorder = asyncHandler(async (req, res) => {
  const raw = Array.isArray(req.body?.ids) ? req.body.ids : [];
  if (raw.length > FEATURED_CAP) {
    return res.status(400).json({ message: `At most ${FEATURED_CAP} products can be ordered at once.` });
  }
  const ids = [...new Set(raw.map((id) => (typeof id === 'string' ? id : String(id ?? ''))))];
  if (ids.some((id) => !mongoose.isValidObjectId(id))) {
    return res.status(400).json({ message: 'Invalid product id in list.' });
  }
  if (ids.length) {
    await Product.bulkWrite(
      ids.map((id, i) => ({
        updateOne: { filter: { _id: id }, update: { $set: { featured: true, featuredSort: i } } },
      })),
      { ordered: false }
    );
  }
  res.json({ ok: true });
});

exports.setFeatured = asyncHandler(async (req, res) => {
  const sort = Math.floor(Number(req.body?.featuredSort || 0));
  const product = await Product.findByIdAndUpdate(
    req.params.id,
    { $set: { featured: req.body?.featured === true || req.body?.featured === 'true', featuredSort: Number.isFinite(sort) ? sort : 0 } },
    UPDATE_OPTS
  );
  if (!product) return res.status(404).json({ message: 'Product not found.' });
  res.json({ product });
});

exports.ithinkWarehouses = asyncHandler(async (_req, res) => {
  const ithink = require('../services/ithinkService');
  const warehouses = await ithink.listWarehouses();
  res.json({ warehouses });
});

exports.bookReturnPickup = asyncHandler(async (req, res) => {
  const ithink = require('../services/ithinkService');
  const doc = await ReturnRequest.findById(req.params.id);
  if (!doc) return res.status(404).json({ message: 'Return not found.' });
  if (doc.status !== 'approved') return res.status(400).json({ message: 'Approve the request before booking a reverse pickup.' });
  if (doc.shipment?.waybill && !req.body.force) {
    return res.status(409).json({ message: 'A reverse pickup is already booked.' });
  }
  const order = await Order.findById(doc.orderId);
  if (!order) return res.status(404).json({ message: 'Order not found.' });
  const booked = await ithink.addOrder(order, {
    orderType: 'reverse',
    orderNumber: `${order.orderNumber}-${doc.type === 'exchange' ? 'X' : 'R'}${req.body.force ? `-${Date.now().toString().slice(-3)}` : ''}`,
  });
  doc.shipment = {
    provider: 'ithink',
    waybill: booked.waybill,
    trackingUrl: booked.trackingUrl,
    lastStatus: 'REV Manifest',
  };
  doc.timeline.push({ status: doc.status, note: `iThink reverse pickup ${booked.waybill}`, at: new Date() });
  await doc.save();
  order.shipment = order.shipment || {};
  order.shipment.returnWaybill = booked.waybill;
  order.shipment.returnTrackingUrl = booked.trackingUrl;
  order.shipment.returnStatus = 'REV Manifest';
  order.timeline = order.timeline || [];
  order.timeline.push({ status: order.status, note: `iThink reverse pickup ${booked.waybill}`, at: new Date() });
  await order.save();
  res.json({ return: doc, order, shipment: booked });
});

const RETURN_STATUSES = ['requested', 'approved', 'rejected', 'refunded', 'restocked'];
// Allowed ReturnRequest status transitions.
const RETURN_TRANSITIONS = {
  requested: ['approved', 'rejected'],
  approved: ['refunded', 'restocked', 'rejected'],
  refunded: ['restocked'],
  restocked: ['refunded'],
  rejected: [],
};

exports.listReturns = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePage(req, 100, 200);
  const filter = {};
  const status = toStr(req.query.status, 20);
  if (status && RETURN_STATUSES.includes(status)) filter.status = status;
  const [returns, total] = await Promise.all([
    ReturnRequest.find(filter)
      .populate('orderId', 'orderNumber total contactName email phone shippingAddress items shipment status payment')
      .populate('userId', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    ReturnRequest.countDocuments(filter),
  ]);
  res.json({ returns, pagination: pageMeta(total, page, limit) });
});

function hadStatus(doc, status) {
  return (doc.timeline || []).some((t) => t.status === status);
}

function setIfPath(doc, path, value) {
  if (ReturnRequest.schema.path(path)) doc.set(path, value);
}

function roundMoney(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Restock lines limited to products in the original order, capped at the ordered quantity. */
function restockLines(doc, order) {
  const orderItems = Array.isArray(order?.items) ? order.items : [];
  const orderedByProduct = new Map();
  for (const line of orderItems) {
    if (!line || !line.productId || line.kind === 'custom_bracelet') continue;
    const key = String(line.productId);
    orderedByProduct.set(key, (orderedByProduct.get(key) || 0) + Math.max(1, Math.floor(Number(line.quantity) || 1)));
  }
  const wanted = new Map();
  for (const item of doc.items || []) {
    if (!item.productId) continue;
    const key = String(item.productId);
    if (!orderedByProduct.has(key)) continue;
    const qty = Math.max(1, Math.floor(Number(item.quantity) || 1));
    wanted.set(key, (wanted.get(key) || 0) + qty);
  }
  return [...wanted.entries()].map(([productId, qty]) => ({
    productId,
    quantity: Math.min(qty, orderedByProduct.get(productId)),
  }));
}

exports.updateReturn = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Return not found.' });
  const doc = await ReturnRequest.findById(req.params.id);
  if (!doc) return res.status(404).json({ message: 'Return not found.' });
  const body = req.body || {};
  const prev = doc.status;

  let nextStatus = prev;
  if (body.status !== undefined && body.status !== null && body.status !== '') {
    nextStatus = toStr(body.status, 20);
    if (!RETURN_STATUSES.includes(nextStatus)) return res.status(400).json({ message: 'Invalid return status.' });
    if (nextStatus !== prev && !(RETURN_TRANSITIONS[prev] || []).includes(nextStatus)) {
      return res.status(409).json({ message: `Cannot move a return from ${prev} to ${nextStatus}.` });
    }
  }
  const becameApproved = nextStatus === 'approved' && prev !== 'approved';
  const becameRefunded = nextStatus === 'refunded' && prev !== 'refunded';
  const becameRestocked = nextStatus === 'restocked' && prev !== 'restocked';
  // Guards against repeating money / stock side effects (e.g. restocked -> refunded -> restocked).
  const alreadyRefunded = Boolean(doc.get('refundId')) || (hadStatus(doc, 'refunded') && prev !== 'approved');
  const alreadyRestocked = hadStatus(doc, 'restocked') || Boolean(doc.get('restockedAt'));

  const order = await Order.findById(doc.orderId);
  if ((becameRefunded || becameRestocked) && !order) {
    return res.status(404).json({ message: 'The order for this return no longer exists.' });
  }

  // Refund amount: never above order total minus refunds already issued on other returns.
  if (body.refundAmount !== undefined && body.refundAmount !== null && body.refundAmount !== '') {
    const amount = typeof body.refundAmount === 'number' || typeof body.refundAmount === 'string' ? Number(body.refundAmount) : NaN;
    if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ message: 'Refund amount must be zero or more.' });
    if (alreadyRefunded && roundMoney(amount) !== roundMoney(doc.refundAmount)) {
      return res.status(409).json({ message: 'This return has already been refunded; the amount cannot change.' });
    }
    doc.refundAmount = roundMoney(amount);
  }
  let refundCap = null;
  if (order) {
    const others = await ReturnRequest.find({
      orderId: order._id,
      _id: { $ne: doc._id },
      // Counts only refunds that went through (a failed attempt is rolled back to 'approved').
      $or: [{ status: 'refunded' }, { status: 'restocked', 'timeline.status': 'refunded' }],
    })
      .select('refundAmount')
      .lean();
    const priorRefunds = others.reduce((sum, r) => sum + Math.max(0, Number(r.refundAmount) || 0), 0);
    refundCap = Math.max(0, roundMoney((Number(order.total) || 0) - priorRefunds));
    if (!alreadyRefunded && (Number(doc.refundAmount) || 0) > refundCap) {
      return res.status(400).json({ message: `Refund amount cannot exceed ${refundCap} (order total minus prior refunds).` });
    }
  }

  if (body.adminNote !== undefined) doc.adminNote = toStr(body.adminNote, 2000);
  doc.status = nextStatus;
  if (nextStatus !== prev) {
    doc.timeline.push({ status: nextStatus, note: toStr(body.adminNote, 2000), at: new Date() });
  }
  await doc.save();

  if (order && becameApproved && !doc.shipment?.waybill) {
    try {
      const ithink = require('../services/ithinkService');
      const booked = await ithink.addOrder(order, {
        orderType: 'reverse',
        orderNumber: `${order.orderNumber}-${doc.type === 'exchange' ? 'X' : 'R'}`,
      });
      doc.shipment = {
        provider: 'ithink',
        waybill: booked.waybill,
        trackingUrl: booked.trackingUrl,
        lastStatus: 'REV Manifest',
      };
      await doc.save();
      order.shipment = order.shipment || {};
      order.shipment.returnWaybill = booked.waybill;
      order.shipment.returnTrackingUrl = booked.trackingUrl;
      order.shipment.returnStatus = 'REV Manifest';
      order.timeline = order.timeline || [];
      order.timeline.push({
        status: order.status,
        note: `iThink reverse pickup ${booked.waybill} for ${doc.type}`,
        at: new Date(),
      });
      await order.save();
    } catch (err) {
      doc.timeline.push({ status: 'approved', note: `iThink reverse pickup failed: ${err.message}`, at: new Date() });
      await doc.save();
    }
  }
  let refundError = null;
  if (order && (becameApproved || becameRefunded)) {
    if ((becameRefunded || (becameApproved && doc.type !== 'exchange')) && canTransition(order.status, 'returned')) {
      order.status = 'returned';
    }
    order.timeline = order.timeline || [];
    if (becameRefunded && !alreadyRefunded) {
      const amount = Math.min(Math.max(0, Number(doc.refundAmount) || 0), refundCap ?? 0);
      if (amount <= 0) {
        order.timeline.push({ status: 'returned', note: 'Return marked refunded with no refund amount.', at: new Date() });
      } else if (order.payment?.gateway === 'cashfree' && order.payment?.cfOrderId) {
        try {
          const cashfree = require('../services/cashfreeService');
          const refund = await cashfree.createRefund(order, {
            amount,
            note: doc.adminNote || `Return ${order.orderNumber}`,
          });
          const refundId = refund?.refund_id || order.payment?.refundId || '';
          setIfPath(doc, 'refundId', refundId);
          doc.timeline.push({ status: 'refunded', note: `Cashfree refund ${refundId} for ${amount}`, at: new Date() });
          await doc.save();
        } catch (err) {
          refundError = err;
        }
      } else {
        // Manual (COD/UPI) refund: track the cumulative amount; only a full refund closes the payment.
        order.payment = order.payment || {};
        order.payment.refundedAmount = roundMoney((Number(order.payment.refundedAmount) || 0) + amount);
        if (order.payment.refundedAmount >= (Number(order.total) || 0) - 0.01) order.payment.status = 'refunded';
      }
    }
    if (refundError) {
      // Roll the return back so the admin can retry; nothing was refunded.
      await Order.updateOne(
        { _id: order._id },
        { $push: { timeline: { status: order.status, note: `Cashfree refund failed: ${toStr(refundError.message, 300)}`, at: new Date() } } }
      );
      doc.status = prev;
      doc.timeline.push({ status: prev, note: `Refund failed, not issued: ${toStr(refundError.message, 300)}`, at: new Date() });
      await doc.save();
      return res.status(502).json({ message: `Cashfree refund failed: ${refundError.message}. The return was left as "${prev}" so you can retry.` });
    }
    order.timeline.push({
      status: order.status,
      note: `${doc.type === 'exchange' ? 'Exchange' : 'Return'} ${doc.status}`,
      at: new Date(),
    });
    await order.save();
  }
  if (order && becameRestocked && !alreadyRestocked) {
    if (order.inventory?.restored) {
      doc.timeline.push({ status: 'restocked', note: 'Order stock was already restored; no stock change.', at: new Date() });
    } else {
      const lines = restockLines(doc, order);
      if (lines.length) {
        await Product.bulkWrite(
          lines.map((l) => ({ updateOne: { filter: { _id: l.productId }, update: { $inc: { stock: l.quantity } } } })),
          { ordered: false }
        );
      }
      doc.timeline.push({
        status: 'restocked',
        note: `Inventory restocked: ${lines.map((l) => `${l.productId} x${l.quantity}`).join(', ') || 'no matching order items'}`,
        at: new Date(),
      });
    }
    setIfPath(doc, 'restockedAt', new Date());
    await doc.save();
  }
  res.json({ return: doc, order });
});

exports.analytics = asyncHandler(async (req, res) => {
  const { from, to, range } = parseRange(req.query);
  const report = await buildReport({ from, to });
  res.json({ range, ...report });
});

const EXPORT_KINDS = ['orders', 'coupons', 'products'];

exports.exportAnalytics = asyncHandler(async (req, res) => {
  // parseRange validates dates and limits the window to 366 days.
  const { from, to } = parseRange(req.query);
  const kind = EXPORT_KINDS.includes(req.query.kind) ? req.query.kind : req.query.kind ? 'products' : 'orders';
  let csv = '';
  if (kind === 'orders') {
    const orders = await Order.find({ createdAt: { $gte: from, $lte: to } })
      .select('orderNumber status total discount email createdAt')
      .sort({ createdAt: -1 })
      .limit(EXPORT_ROW_CAP)
      .lean();
    csv = toCsv(orders, [
      { label: 'orderNumber', value: (o) => o.orderNumber },
      { label: 'status', value: (o) => o.status },
      { label: 'total', value: (o) => o.total },
      { label: 'discount', value: (o) => o.discount || 0 },
      { label: 'email', value: (o) => o.email },
      { label: 'createdAt', value: (o) => o.createdAt },
    ]);
  } else if (kind === 'coupons') {
    const coupons = await require('../models/Coupon')
      .find()
      .select('code usedCount revenueGenerated discountCost')
      .limit(EXPORT_ROW_CAP)
      .lean();
    csv = toCsv(coupons, [
      { label: 'code', value: (c) => c.code },
      { label: 'usedCount', value: (c) => c.usedCount || 0 },
      { label: 'revenueGenerated', value: (c) => c.revenueGenerated || 0 },
      { label: 'discountCost', value: (c) => c.discountCost || 0 },
    ]);
  } else {
    const report = await buildReport({ from, to });
    csv = toCsv(report.bestSellers, [
      { label: 'name', value: (p) => p.name },
      { label: 'qty', value: (p) => p.qty },
      { label: 'revenue', value: (p) => p.revenue },
    ]);
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${kind}.csv"`);
  res.send(csv);
});

exports.customerProfile = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Customer not found.' });
  const user = await User.findById(req.params.id).populate('groupIds', 'name slug color').select('-passwordHash -tokenVersion').lean();
  if (!user) return res.status(404).json({ message: 'Customer not found.' });
  const orders = await Order.find({ userId: user._id }).sort({ createdAt: -1 }).limit(500).lean();
  const spent = orders.reduce((s, o) => s + (o.total || 0), 0);
  const aov = orders.length ? Math.round(spent / orders.length) : 0;
  const productMap = new Map();
  for (const o of orders) {
    for (const item of o.items || []) {
      const name = item.snapshot?.name || item.name || 'Custom bracelet';
      const prev = productMap.get(name) || { name, qty: 0 };
      prev.qty += item.quantity || 1;
      productMap.set(name, prev);
    }
  }
  const coupons = await CouponUsage.find({ userId: user._id }).sort({ createdAt: -1 }).limit(200).lean();
  res.json({
    customer: {
      ...user,
      orders: orders.length,
      spent,
      aov,
      lastOrder: orders[0]?.createdAt || null,
    },
    orders,
    topProducts: [...productMap.values()].sort((a, b) => b.qty - a.qty).slice(0, 8),
    couponsUsed: coupons,
  });
});

exports.assignGroups = asyncHandler(async (req, res) => {
  const raw = Array.isArray(req.body?.groupIds) ? req.body.groupIds : [];
  const groupIds = [...new Set(raw.map((id) => (typeof id === 'string' ? id : String(id ?? ''))))];
  if (groupIds.length > 50 || groupIds.some((id) => !mongoose.isValidObjectId(id))) {
    return res.status(400).json({ message: 'Invalid customer group list.' });
  }
  const user = await User.findByIdAndUpdate(req.params.id, { $set: { groupIds } }, UPDATE_OPTS)
    .select('-passwordHash -tokenVersion')
    .populate('groupIds', 'name slug');
  if (!user) return res.status(404).json({ message: 'Customer not found.' });
  res.json({ user });
});

exports.remindAbandoned = asyncHandler(async (req, res) => {
  const cart = await Cart.findById(req.params.id).populate('userId', 'name email');
  if (!cart) return res.status(404).json({ message: 'Cart not found.' });
  cart.remindedAt = new Date();
  await cart.save();
  await notify({
    type: 'abandoned_cart',
    title: 'Abandoned cart reminder queued',
    body: cart.userId ? `${cart.userId.name} (${cart.userId.email})` : 'Unknown customer',
    link: '/admin/abandoned-carts',
    meta: { cartId: cart._id, email: cart.userId?.email },
  });
  res.json({ ok: true, cart });
});

exports.publicCollections = asyncHandler(async (_req, res) => {
  const collections = await listPublicCollections();
  res.json({ collections });
});

exports.publicCollection = asyncHandler(async (req, res) => {
  const collection = await getBySlug(toStr(req.params.slug, 120));
  if (!collection) return res.status(404).json({ message: 'Collection not found.' });
  const saleMap = await getSalePriceMap();
  let products = await productsForCollection(collection);
  products = products.map((p) => attachProductRating(applySaleToProduct(p, saleMap)));
  const { _id, name, slug, description, image, sortOrder, ruleType } = collection;
  res.json({ collection: { _id, name, slug, description, image, sortOrder, ruleType }, products });
});

exports.publicBanners = asyncHandler(async (req, res) => {
  const now = new Date();
  const filter = { isActive: true };
  const placement = toStr(req.query.placement, 30);
  if (placement) filter.placement = placement;
  const banners = (
    await Banner.find(filter)
      .select('title image mobileImage link placement sortOrder startsAt endsAt')
      .sort({ sortOrder: 1 })
      .limit(100)
      .lean()
  ).filter((b) =>
    sectionLive({ enabled: true, startsAt: b.startsAt, endsAt: b.endsAt }, now)
  );
  res.json({ banners });
});

exports.publicFlash = asyncHandler(async (_req, res) => {
  const sales = await getActiveSales();
  const sale = sales[0] || null;
  const saleMap = await getSalePriceMap();
  const products = (sale?.items || [])
    .map((item) => {
      const product = item.productId;
      if (!product || typeof product !== 'object' || product.isActive === false) return null;
      return attachProductRating(applySaleToProduct(product, saleMap));
    })
    .filter(Boolean);
  // Internal stats (revenue, unitsSold, discountCost) and raw item pricing are never exposed.
  const publicSale = sale
    ? { _id: sale._id, name: sale.name, startsAt: sale.startsAt, endsAt: sale.endsAt, isActive: sale.isActive }
    : null;
  res.json({
    sale: publicSale,
    products,
    now: new Date(),
    endsAt: sale?.endsAt || null,
  });
});

const DEFAULT_FAQS = [
  { question: 'How long does delivery take?', answer: 'Most ready-made pieces leave the atelier in 2–4 working days. Custom strands take a little longer — usually 5–8 working days.', sortOrder: 1, isActive: true },
  { question: 'Can I return a custom bracelet?', answer: 'Custom studio strands are made to your purpose and date of birth and are not eligible for return, except for manufacturing defects.', sortOrder: 2, isActive: true },
  { question: 'Do you offer cash on delivery?', answer: 'COD and UPI are available when enabled in store settings. Free shipping applies above the threshold shown at checkout.', sortOrder: 3, isActive: true },
];

/** Seeds starter FAQs when the collection is empty. Call once at startup, never from a request path. */
async function ensureDefaultFaqs() {
  if (await Faq.countDocuments()) return;
  await Faq.insertMany(DEFAULT_FAQS);
}
exports.ensureDefaultFaqs = ensureDefaultFaqs;

exports.publicFaqs = asyncHandler(async (_req, res) => {
  const faqs = await Faq.find({ isActive: true }).select('question answer sortOrder').sort({ sortOrder: 1 }).limit(200).lean();
  res.json({ faqs });
});

exports.publicBlog = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePage(req, 20, 50);
  const filter = { isPublished: true };
  const [posts, total] = await Promise.all([
    BlogPost.find(filter)
      .select('title slug excerpt image author publishedAt createdAt seo')
      .sort({ publishedAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    BlogPost.countDocuments(filter),
  ]);
  res.json({ posts, pagination: pageMeta(total, page, limit) });
});

exports.publicBlogOne = asyncHandler(async (req, res) => {
  const post = await BlogPost.findOne({ slug: toStr(req.params.slug, 200), isPublished: true }).lean();
  if (!post) return res.status(404).json({ message: 'Post not found.' });
  res.json({ post });
});

const EMAIL_RX = /^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,}$/;

exports.subscribe = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const email = toStr(body.email, 300).toLowerCase();
  if (!email || email.length > 254 || !EMAIL_RX.test(email)) {
    return res.status(400).json({ message: 'A valid email is required.' });
  }
  const name = toStr(body.name, 100);
  const source = toStr(body.source, 40).replace(/[^a-z0-9_-]/gi, '') || 'site';
  // Existing subscribers keep their name/source; only (re)activate them.
  const sub = await Newsletter.findOneAndUpdate(
    { email },
    { $set: { isActive: true }, $setOnInsert: { email, name, source } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true, runValidators: true }
  );
  res.status(201).json({ ok: true, subscriber: { email: sub.email } });
});

exports.contact = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const name = toStr(body.name, 100);
  const email = toStr(body.email, 300).toLowerCase();
  const phone = toStr(body.phone, 20);
  const message = toStr(body.message, 5000);
  if (!name || !email || !message) return res.status(400).json({ message: 'Name, email and message are required.' });
  if (email.length > 254 || !EMAIL_RX.test(email)) return res.status(400).json({ message: 'A valid email is required.' });
  const doc = await ContactMessage.create({ name, email, phone, message });
  await notify({
    type: 'contact',
    title: `Message from ${name}`,
    body: message.slice(0, 140),
    link: '/admin/contacts',
    meta: { email },
  });
  res.status(201).json({ ok: true, id: doc._id });
});

exports.checkPin = asyncHandler(async (req, res) => {
  const result = (await checkPincode(toStr(req.params.pincode || req.query.pincode, 10))) || {};
  const pick = ['serviceable', 'prepaid', 'cod', 'pickup', 'found', 'extraFee', 'estimatedDays', 'city', 'state', 'source', 'carriers'];
  res.json(Object.fromEntries(pick.filter((k) => result[k] !== undefined).map((k) => [k, result[k]])));
});

exports.reverseGeo = asyncHandler(async (req, res) => {
  const geo = require('../services/geoService');
  const address = await geo.reverse(req.query.lat, req.query.lng);
  res.json({ address });
});

exports.checkoutQuote = asyncHandler(async (req, res) => {
  const Cart = require('../models/Cart');
  const cart = await Cart.findOne({ userId: req.user._id });
  if (!cart || !cart.items.length) return res.json({ quote: { items: [], subtotal: 0, total: 0 } });
  const result = await quote({
    items: cart.items.map((i) => i.toObject()),
    couponCode: toStr(req.query.coupon, 40) || cart.couponCode,
    user: req.user,
    pincode: toStr(req.query.pincode, 10),
  });
  res.json({ quote: result });
});

exports.publicCoupons = asyncHandler(async (req, res) => {
  let items = [];
  let subtotal = 0;
  if (req.user?._id) {
    const cart = await Cart.findOne({ userId: req.user._id }).lean();
    items = cart?.items || [];
    subtotal = items.reduce((sum, item) => sum + (item.lineTotal || 0), 0);
  }
  const coupons = await listAvailableCoupons({ user: req.user, items, subtotal });
  res.json({
    count: coupons.length,
    usableCount: coupons.filter((c) => c.usable).length,
    coupons,
  });
});

exports.publicStore = asyncHandler(async (_req, res) => {
  const [settings, bracelet] = await Promise.all([
    StoreSettings.findOne({ key: 'store' }).lean(),
    BraceletConfig.findOne().lean(),
  ]);
  res.json({
    store: {
      storeName: settings?.storeName || 'Kuberstones',
      logo: settings?.logo || '',
      email: settings?.email || '',
      phone: settings?.phone || '',
      currency: settings?.currency || 'INR',
      seo: {
        title: settings?.seo?.title || settings?.storeName || 'Kuberstones',
        description: settings?.seo?.description || '',
        keywords: settings?.seo?.keywords || '',
        ogImage: settings?.seo?.ogImage || '',
        noIndex: Boolean(settings?.seo?.noIndex),
      },
    },
    studioModes: activeStudioModes(bracelet),
  });
});

exports.homeCollections = asyncHandler(async (_req, res) => {
  const [best, fresh, trending] = await Promise.all([
    Collection.findOne({ slug: 'best-sellers', isActive: true }).lean(),
    Collection.findOne({ slug: 'new-arrivals', isActive: true }).lean(),
    Collection.findOne({ slug: 'trending', isActive: true }).lean(),
  ]);
  const saleMap = await getSalePriceMap();
  const decorate = (products) => products.map((p) => attachProductRating(applySaleToProduct(p, saleMap)));
  const [bestsellers, newArrivals, trendingProducts] = await Promise.all([
    best ? productsForCollection(best) : productsForCollection({ ruleType: 'bestsellers', ruleConfig: { limit: 8 } }),
    fresh ? productsForCollection(fresh) : productsForCollection({ ruleType: 'new_arrivals', ruleConfig: { limit: 8, days: 30 } }),
    trending
      ? productsForCollection(trending)
      : productsForCollection({ ruleType: 'trending', ruleConfig: { limit: 8, days: 14 } }),
  ]);
  res.json({
    bestsellers: decorate(bestsellers),
    newArrivals: decorate(newArrivals),
    trending: decorate(trendingProducts),
  });
});
