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
const { asyncHandler, slugifyName, cleanBody, escapeRegex } = require('../utils/asyncHandler');
const { parsePage, pageMeta, parseSort } = require('../utils/pagination');
const { notify, unreadCount } = require('../services/notificationService');
const { productsForCollection, listPublicCollections, getBySlug } = require('../services/collectionService');
const { getActiveSales, getSalePriceMap, applySaleToProduct } = require('../services/flashSaleService');
const { quote, checkPincode } = require('../services/checkoutService');
const { buildReport, parseRange, toCsv } = require('../services/analyticsService');
const { couponStatus } = require('../services/couponService');
const { sectionLive } = require('../data/homeLayout');

function crud(Model, { slugFrom } = {}) {
  return {
    list: asyncHandler(async (req, res) => {
      const { page, limit, skip } = parsePage(req);
      const sort = parseSort(req, ['createdAt', 'name', 'sortOrder', 'title', 'question'], '-createdAt');
      const filter = {};
      if (req.query.q) {
        const rx = new RegExp(escapeRegex(req.query.q), 'i');
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
      const data = cleanBody(req.body);
      if (slugFrom && !data.slug && data[slugFrom]) data.slug = slugifyName(data[slugFrom]);
      const doc = req.params.id
        ? await Model.findByIdAndUpdate(req.params.id, data, { new: true })
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
  const sales = await FlashSale.find().populate('items.productId', 'name sku price').sort({ createdAt: -1 }).lean();
  const now = new Date();
  res.json({
    sales: sales.map((s) => ({
      ...s,
      live: s.isActive && s.startsAt <= now && s.endsAt >= now,
    })),
  });
});

exports.saveFlashSale = asyncHandler(async (req, res) => {
  const data = cleanBody(req.body);
  const sale = req.params.id
    ? await FlashSale.findByIdAndUpdate(req.params.id, data, { new: true })
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
    ? await BlogPost.findByIdAndUpdate(req.params.id, data, { new: true })
    : await BlogPost.create(data);
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
  const rows = await Newsletter.find().sort({ createdAt: -1 }).lean();
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

exports.featuredList = asyncHandler(async (_req, res) => {
  const products = await Product.find().sort({ featured: -1, featuredSort: 1, name: 1 }).lean();
  res.json({ products });
});

exports.featuredReorder = asyncHandler(async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  await Promise.all(
    ids.map((id, i) => Product.findByIdAndUpdate(id, { featured: true, featuredSort: i }))
  );
  res.json({ ok: true });
});

exports.setFeatured = asyncHandler(async (req, res) => {
  const product = await Product.findByIdAndUpdate(
    req.params.id,
    { featured: Boolean(req.body.featured), featuredSort: Number(req.body.featuredSort || 0) },
    { new: true }
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

exports.listReturns = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  const returns = await ReturnRequest.find(filter)
    .populate('orderId', 'orderNumber total contactName email phone shippingAddress items shipment status payment')
    .populate('userId', 'name email')
    .sort({ createdAt: -1 })
    .lean();
  res.json({ returns });
});

exports.updateReturn = asyncHandler(async (req, res) => {
  const doc = await ReturnRequest.findById(req.params.id);
  if (!doc) return res.status(404).json({ message: 'Return not found.' });
  const prev = doc.status;
  if (req.body.status) doc.status = req.body.status;
  if (req.body.adminNote !== undefined) doc.adminNote = req.body.adminNote;
  if (req.body.refundAmount != null) doc.refundAmount = Number(req.body.refundAmount);
  if (req.body.status && req.body.status !== prev) {
    doc.timeline.push({ status: req.body.status, note: req.body.adminNote || '', at: new Date() });
  }
  await doc.save();

  const order = await Order.findById(doc.orderId);
  const becameApproved = doc.status === 'approved' && prev !== 'approved';
  const becameRefunded = doc.status === 'refunded' && prev !== 'refunded';
  const becameRestocked = doc.status === 'restocked' && prev !== 'restocked';
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
  if (order && (becameApproved || becameRefunded)) {
    if (becameRefunded || (becameApproved && doc.type !== 'exchange')) {
      order.status = 'returned';
    }
    if (becameRefunded) {
      if (order.payment?.gateway === 'cashfree' && order.payment?.cfOrderId && order.payment?.status !== 'refunded') {
        try {
          const cashfree = require('../services/cashfreeService');
          await cashfree.createRefund(order, {
            amount: doc.refundAmount != null ? doc.refundAmount : order.total,
            note: doc.adminNote || `Return ${order.orderNumber}`,
          });
        } catch (err) {
          order.payment = order.payment || {};
          order.timeline = order.timeline || [];
          order.timeline.push({
            status: 'returned',
            note: `Cashfree refund failed: ${err.message}`,
            at: new Date(),
          });
        }
      } else {
        order.payment = order.payment || {};
        order.payment.status = 'refunded';
      }
    }
    order.timeline = order.timeline || [];
    order.timeline.push({
      status: order.status,
      note: `${doc.type === 'exchange' ? 'Exchange' : 'Return'} ${doc.status}`,
      at: new Date(),
    });
    await order.save();
  }
  if (becameRestocked) {
    for (const item of doc.items || []) {
      if (!item.productId) continue;
      await Product.findByIdAndUpdate(item.productId, { $inc: { stock: item.quantity || 1 } });
    }
  }
  res.json({ return: doc, order });
});

exports.analytics = asyncHandler(async (req, res) => {
  const { from, to, range } = parseRange(req.query);
  const report = await buildReport({ from, to });
  res.json({ range, ...report });
});

exports.exportAnalytics = asyncHandler(async (req, res) => {
  const { from, to } = parseRange(req.query);
  const kind = req.query.kind || 'orders';
  let csv = '';
  if (kind === 'orders') {
    const orders = await Order.find({ createdAt: { $gte: from, $lte: to } }).lean();
    csv = toCsv(orders, [
      { label: 'orderNumber', value: (o) => o.orderNumber },
      { label: 'status', value: (o) => o.status },
      { label: 'total', value: (o) => o.total },
      { label: 'discount', value: (o) => o.discount || 0 },
      { label: 'email', value: (o) => o.email },
      { label: 'createdAt', value: (o) => o.createdAt },
    ]);
  } else if (kind === 'coupons') {
    const coupons = await require('../models/Coupon').find().lean();
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
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=${kind}.csv`);
  res.send(csv);
});

exports.customerProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).populate('groupIds', 'name slug color').select('-passwordHash').lean();
  if (!user) return res.status(404).json({ message: 'Customer not found.' });
  const orders = await Order.find({ userId: user._id }).sort({ createdAt: -1 }).lean();
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
  const coupons = await CouponUsage.find({ userId: user._id }).sort({ createdAt: -1 }).lean();
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
  const user = await User.findByIdAndUpdate(req.params.id, { groupIds: req.body.groupIds || [] }, { new: true })
    .select('-passwordHash')
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
  const collection = await getBySlug(req.params.slug);
  if (!collection) return res.status(404).json({ message: 'Collection not found.' });
  const saleMap = await getSalePriceMap();
  let products = await productsForCollection(collection);
  products = products.map((p) => applySaleToProduct(p, saleMap));
  res.json({ collection, products });
});

exports.publicBanners = asyncHandler(async (req, res) => {
  const now = new Date();
  const filter = { isActive: true };
  if (req.query.placement) filter.placement = req.query.placement;
  const banners = (await Banner.find(filter).sort({ sortOrder: 1 }).lean()).filter((b) =>
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
      return applySaleToProduct(product, saleMap);
    })
    .filter(Boolean);
  res.json({
    sale,
    products,
    now: new Date(),
    endsAt: sale?.endsAt || null,
  });
});

exports.publicFaqs = asyncHandler(async (_req, res) => {
  if (!(await Faq.countDocuments())) {
    await Faq.insertMany([
      { question: 'How long does delivery take?', answer: 'Most ready-made pieces leave the atelier in 2–4 working days. Custom strands take a little longer — usually 5–8 working days.', sortOrder: 1, isActive: true },
      { question: 'Can I return a custom bracelet?', answer: 'Custom studio strands are made to your purpose and date of birth and are not eligible for return, except for manufacturing defects.', sortOrder: 2, isActive: true },
      { question: 'Do you offer cash on delivery?', answer: 'COD and UPI are available when enabled in store settings. Free shipping applies above the threshold shown at checkout.', sortOrder: 3, isActive: true },
    ]);
  }
  const faqs = await Faq.find({ isActive: true }).sort({ sortOrder: 1 }).lean();
  res.json({ faqs });
});

exports.publicBlog = asyncHandler(async (_req, res) => {
  const posts = await BlogPost.find({ isPublished: true }).sort({ publishedAt: -1, createdAt: -1 }).lean();
  res.json({ posts });
});

exports.publicBlogOne = asyncHandler(async (req, res) => {
  const post = await BlogPost.findOne({ slug: req.params.slug, isPublished: true }).lean();
  if (!post) return res.status(404).json({ message: 'Post not found.' });
  res.json({ post });
});

exports.subscribe = asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').toLowerCase().trim();
  if (!email || !email.includes('@')) return res.status(400).json({ message: 'A valid email is required.' });
  const sub = await Newsletter.findOneAndUpdate(
    { email },
    { email, name: req.body.name, source: req.body.source || 'site', isActive: true },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  res.status(201).json({ ok: true, subscriber: { email: sub.email } });
});

exports.contact = asyncHandler(async (req, res) => {
  const { name, email, phone, message } = req.body || {};
  if (!name || !email || !message) return res.status(400).json({ message: 'Name, email and message are required.' });
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
  const result = await checkPincode(req.query.pincode || req.params.pincode);
  res.json(result);
});

exports.checkoutQuote = asyncHandler(async (req, res) => {
  const Cart = require('../models/Cart');
  const cart = await Cart.findOne({ userId: req.user._id });
  if (!cart || !cart.items.length) return res.json({ quote: { items: [], subtotal: 0, total: 0 } });
  const result = await quote({
    items: cart.items.map((i) => i.toObject()),
    couponCode: req.query.coupon || cart.couponCode,
    user: req.user,
    pincode: req.query.pincode,
  });
  res.json({ quote: result });
});

exports.homeCollections = asyncHandler(async (_req, res) => {
  const [best, fresh, trending] = await Promise.all([
    Collection.findOne({ slug: 'best-sellers', isActive: true }).lean(),
    Collection.findOne({ slug: 'new-arrivals', isActive: true }).lean(),
    Collection.findOne({ slug: 'trending', isActive: true }).lean(),
  ]);
  const saleMap = await getSalePriceMap();
  const decorate = (products) => products.map((p) => applySaleToProduct(p, saleMap));
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
