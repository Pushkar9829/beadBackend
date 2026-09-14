const StoreSettings = require('../models/StoreSettings');
const Collection = require('../models/Collection');
const Product = require('../models/Product');
const Attribute = require('../models/Attribute');
const Coupon = require('../models/Coupon');
const CouponUsage = require('../models/CouponUsage');
const Offer = require('../models/Offer');
const FlashSale = require('../models/FlashSale');
const Banner = require('../models/Banner');
const Faq = require('../models/Faq');
const BlogPost = require('../models/BlogPost');
const Pincode = require('../models/Pincode');
const CustomerGroup = require('../models/CustomerGroup');
const Newsletter = require('../models/Newsletter');
const ContactMessage = require('../models/ContactMessage');
const Media = require('../models/Media');
const Wishlist = require('../models/Wishlist');
const Notification = require('../models/Notification');
const StockAdjustment = require('../models/StockAdjustment');
const Order = require('../models/Order');
const ReturnRequest = require('../models/ReturnRequest');
const Cart = require('../models/Cart');
const WebhookEvent = require('../models/WebhookEvent');

const DAYS = 24 * 60 * 60 * 1000;

function daysAgo(n) {
  return new Date(Date.now() - n * DAYS);
}

function daysFromNow(n) {
  return new Date(Date.now() + n * DAYS);
}

function snapshot(product, qty = 1) {
  return {
    kind: 'product',
    productId: product._id,
    quantity: qty,
    unitPrice: product.price,
    lineTotal: product.price * qty,
    snapshot: {
      name: product.name,
      sku: product.sku || product.slug,
      image: product.images?.[0] || '',
    },
  };
}

async function seedPlatform({ admin, demo, products, beads }) {
  const [aries, lifePath, heart, rudraksha, amethyst, lapis] = products;
  const address = demo.addresses?.[0] || {
    label: 'Home',
    line1: '12 Lotus Lane',
    city: 'Mumbai',
    state: 'Maharashtra',
    pincode: '400001',
    country: 'India',
    phone: demo.phone,
  };

  const groups = await CustomerGroup.insertMany([
    { name: 'Atelier circle', slug: 'atelier-circle', description: 'Repeat customers who buy ready strands and custom pieces.', color: '#C6A75E' },
    { name: 'First visit', slug: 'first-visit', description: 'New accounts that have not placed a paid order yet.', color: '#6B3FA0' },
  ]);
  demo.groupIds = [groups[0]._id];
  await demo.save();

  const collections = await Collection.insertMany([
    { name: 'Best sellers', slug: 'best-sellers', description: 'Pieces the atelier sells most often.', ruleType: 'bestsellers', ruleConfig: { limit: 12 }, sortOrder: 1 },
    { name: 'New arrivals', slug: 'new-arrivals', description: 'Recently added strands.', ruleType: 'new_arrivals', ruleConfig: { days: 60, limit: 12 }, sortOrder: 2 },
    { name: 'Trending', slug: 'trending', description: 'Currently watched collections.', ruleType: 'trending', ruleConfig: { limit: 12 }, sortOrder: 3 },
    { name: 'Featured', slug: 'featured', description: 'Editor selection from the three houses.', ruleType: 'featured', ruleConfig: { limit: 12 }, sortOrder: 4 },
    { name: 'Under ₹2000', slug: 'under-2000', description: 'Everyday strands below two thousand rupees.', ruleType: 'under_price', ruleConfig: { maxPrice: 2000, limit: 12 }, sortOrder: 5 },
    { name: 'Atelier edit', slug: 'atelier-edit', description: 'A hand-picked tray for the homepage.', ruleType: 'manual', sortOrder: 6 },
  ]);
  const atelier = collections.find((row) => row.slug === 'atelier-edit');
  await Product.updateMany(
    { _id: { $in: [aries._id, heart._id, rudraksha._id] } },
    { $addToSet: { collectionIds: atelier._id } }
  );

  await StoreSettings.create({
    key: 'store',
    storeName: 'Kuberstones',
    email: 'hello@kuberstones.com',
    phone: '',
    currency: 'INR',
    payment: {
      cod: true,
      upi: true,
      gateway: 'Cashfree',
      upiId: 'kuberstones@upi',
      cashfreeEnabled: true,
      cashfreeEnv: 'sandbox',
    },
    shipping: {
      fee: 79,
      freeThreshold: 999,
      estimatedDays: 5,
      ithinkEnabled: true,
      ithinkEnv: 'production',
      ithinkLogistics: 'delhivery',
      defaultLengthCm: 10,
      defaultWidthCm: 10,
      defaultHeightCm: 5,
      defaultWeightGrams: 400,
    },
    tax: { gstPercent: 3 },
    notifications: { email: true, sms: false, whatsapp: false },
    seo: {
      title: 'Kuberstones',
      description: 'Crystals. Gemstones. Rudraksha. Personalized with purpose.',
      keywords: 'crystal bracelet, rudraksha, gemstones, custom bracelet, Kuberstones',
    },
  });

  await Attribute.insertMany([
    { name: 'Chakra', slug: 'chakra', type: 'select', options: ['Root', 'Sacral', 'Solar Plexus', 'Heart', 'Throat', 'Third Eye', 'Crown'], appliesTo: 'both', sortOrder: 1 },
    { name: 'Origin', slug: 'origin', type: 'text', appliesTo: 'both', sortOrder: 2 },
    { name: 'Wrist size', slug: 'wrist-size', type: 'select', options: ['5.5"', '6"', '6.5"', '7"', '7.5"', '8"'], appliesTo: 'product', sortOrder: 3 },
  ]);

  const welcome = await Coupon.create({
    code: 'WELCOME10',
    type: 'percent',
    value: 10,
    minOrder: 999,
    maxDiscount: 400,
    applyTo: 'all',
    audience: 'new',
    usageLimit: 500,
    perCustomerLimit: 1,
    startsAt: daysAgo(7),
    endsAt: daysFromNow(90),
    isActive: true,
  });
  const flat = await Coupon.create({
    code: 'KS500',
    type: 'fixed',
    value: 500,
    minOrder: 2499,
    applyTo: 'all',
    audience: 'all',
    perCustomerLimit: 2,
    startsAt: daysAgo(2),
    endsAt: daysFromNow(45),
    isActive: true,
  });

  await Offer.insertMany([
    { name: 'Free shipping over ₹999', type: 'free_shipping', minOrder: 999, isActive: true },
    { name: 'Pair two strands', type: 'percent', percent: 8, minOrder: 1999, productIds: [heart._id, rudraksha._id], isActive: true },
  ]);

  await FlashSale.create({
    name: 'Equinox tray',
    isActive: true,
    startsAt: daysAgo(1),
    endsAt: daysFromNow(6),
    items: [
      { productId: heart._id, salePrice: 1499, percent: 12 },
      { productId: aries._id, salePrice: 1699, percent: 11 },
    ],
    revenue: 3198,
    unitsSold: 2,
    discountCost: 400,
  });

  await Banner.insertMany([
    { title: 'Compose a strand', image: '/catalog/products/heart-line-rose-bracelet.jpg', link: '/customize', placement: 'home', sortOrder: 1, isActive: true },
    { title: 'Shop the houses', image: '/catalog/products/aries-fire-bracelet.jpg', link: '/shop', placement: 'shop', sortOrder: 1, isActive: true },
    { title: 'Rudraksha daily wear', image: '/catalog/products/five-mukhi-rudraksha-bracelet.jpg', link: '/rudraksha', placement: 'category', sortOrder: 1, isActive: true },
  ]);

  await Faq.insertMany([
    { question: 'How long does delivery take?', answer: 'Ready-made pieces usually leave the atelier in 2–4 working days. Customized strands typically need 5–8 working days after the composition is confirmed.', sortOrder: 1 },
    { question: 'Can I return a custom bracelet?', answer: 'Personalized or customized pieces are generally not eligible for change-of-mind returns once preparation has started. Wrong, damaged or materially not-as-described items can still be reviewed.', sortOrder: 2 },
    { question: 'Do you offer cash on delivery?', answer: 'COD is offered when it is enabled in store settings and the pincode is serviceable for cash collection. Online payment stays available through Cashfree.', sortOrder: 3 },
    { question: 'How do I track a shipment?', answer: 'Open Account, find the order, and use Refresh tracking once an iThink waybill is booked. The same tracking link is shown after dispatch.', sortOrder: 4 },
    { question: 'What pincode do you ship to?', answer: 'Checkout checks live iThink serviceability for Indian pincodes. Local overrides in admin can block a pin or add an extra fee.', sortOrder: 5 },
  ]);

  await BlogPost.insertMany([
    {
      title: 'How we choose crystals for a purpose',
      slug: 'how-we-choose-crystals-for-a-purpose',
      excerpt: 'A short note on purpose, intention, and why every bead on a Kuberstones strand has a reason.',
      body: 'A Kuberstones bracelet starts with a purpose, then an intention. Beads are placed from that pairing, then from Mulank and zodiac where you ask for them. The composition is traditional and spiritual — not a medical claim. Care notes live on each stone so the strand can be worn every day.',
      image: '/catalog/products/heart-line-rose-bracelet.jpg',
      author: 'Kuberstones',
      isPublished: true,
      publishedAt: daysAgo(12),
      seo: { title: 'How we choose crystals for a purpose | Kuberstones', description: 'Purpose, intention, and bead reasons behind a Kuberstones strand.' },
    },
    {
      title: 'Wearing rudraksha with crystal',
      slug: 'wearing-rudraksha-with-crystal',
      excerpt: 'Five-mukhi rudraksha can sit beside a crystal strand when the making stays quiet and exact.',
      body: 'Rudraksha and crystal are two houses in the same atelier. If you wear both, keep the rudraksha strand simple and let the crystal bracelet carry the intention work. Cleanse them separately and avoid soaking rudraksha for long periods.',
      image: '/catalog/products/five-mukhi-rudraksha-bracelet.jpg',
      author: 'Kuberstones',
      isPublished: true,
      publishedAt: daysAgo(5),
    },
  ]);

  await Pincode.insertMany([
    { pincode: '400001', city: 'Mumbai', state: 'Maharashtra', serviceable: true, extraFee: 0, estimatedDays: 3 },
    { pincode: '110001', city: 'New Delhi', state: 'Delhi', serviceable: true, extraFee: 0, estimatedDays: 4 },
    { pincode: '560001', city: 'Bengaluru', state: 'Karnataka', serviceable: true, extraFee: 0, estimatedDays: 4 },
    { pincode: '600001', city: 'Chennai', state: 'Tamil Nadu', serviceable: true, extraFee: 40, estimatedDays: 5 },
    { pincode: '999999', city: 'Test', state: 'Test', serviceable: false, extraFee: 0, estimatedDays: 5 },
  ]);

  await Newsletter.insertMany([
    { email: 'demo@kuberstones.com', name: 'Aarav Mehta', source: 'seed' },
    { email: 'journal@kuberstones.com', name: 'Journal list', source: 'footer' },
  ]);

  await ContactMessage.insertMany([
    { name: 'Diya Shah', email: 'diya@example.com', phone: '9811111111', message: 'Do you make a 7" wrist for the Heart Line Rose bracelet?', read: false },
    { name: 'Kabir Rao', email: 'kabir@example.com', message: 'Please confirm COD for pincode 560001.', read: true },
  ]);

  await Media.insertMany([
    { filename: 'aries-fire-bracelet.jpg', originalName: 'aries-fire-bracelet.jpg', url: '/catalog/products/aries-fire-bracelet.jpg', mimeType: 'image/jpeg', folder: 'product', tags: ['crystals'] },
    { filename: 'heart-line-rose-bracelet.jpg', originalName: 'heart-line-rose-bracelet.jpg', url: '/catalog/products/heart-line-rose-bracelet.jpg', mimeType: 'image/jpeg', folder: 'product', tags: ['love'] },
    { filename: 'five-mukhi-rudraksha-bracelet.jpg', originalName: 'five-mukhi-rudraksha-bracelet.jpg', url: '/catalog/products/five-mukhi-rudraksha-bracelet.jpg', mimeType: 'image/jpeg', folder: 'product', tags: ['rudraksha'] },
  ]);

  await Wishlist.create({
    userId: demo._id,
    items: [
      { productId: heart._id, addedAt: daysAgo(4) },
      { productId: amethyst._id, addedAt: daysAgo(1) },
    ],
  });

  await Cart.findOneAndUpdate(
    { userId: demo._id },
    {
      $set: {
        couponCode: 'WELCOME10',
        items: [snapshot(lifePath, 1)],
      },
    }
  );

  const deliveredItems = [snapshot(heart, 1)];
  const delivered = await Order.create({
    orderNumber: 'KS-100001',
    userId: demo._id,
    email: demo.email,
    contactName: demo.name,
    phone: demo.phone,
    items: deliveredItems,
    subtotal: heart.price,
    discount: 0,
    tax: 51,
    shippingFee: 0,
    total: heart.price + 51,
    shippingAddress: address,
    status: 'delivered',
    payment: { method: 'cod', status: 'paid', capturedAt: daysAgo(18) },
    shipment: { provider: 'ithink', carrier: 'delhivery', waybill: 'SEEDFWD100001', lastStatus: 'Delivered', orderType: 'forward' },
    timeline: [
      { status: 'processing', note: 'Placed via cod', at: daysAgo(20) },
      { status: 'shipped', note: 'iThink booked SEEDFWD100001', at: daysAgo(18) },
      { status: 'delivered', note: 'iThink: Delivered', at: daysAgo(14) },
    ],
    createdAt: daysAgo(20),
  });

  const processing = await Order.create({
    orderNumber: 'KS-100002',
    userId: demo._id,
    email: demo.email,
    contactName: demo.name,
    phone: demo.phone,
    items: [snapshot(rudraksha, 1)],
    subtotal: rudraksha.price,
    discount: 130,
    tax: 0,
    shippingFee: 0,
    total: rudraksha.price - 130,
    couponCode: welcome.code,
    couponId: welcome._id,
    shippingAddress: address,
    status: 'processing',
    payment: { method: 'upi', status: 'pending', upiRef: 'UPISEED100002' },
    timeline: [{ status: 'pending_payment', note: 'Placed via upi', at: daysAgo(2) }],
  });

  await Order.create({
    orderNumber: 'KS-100003',
    userId: demo._id,
    email: demo.email,
    contactName: demo.name,
    phone: demo.phone,
    items: [snapshot(aries, 1)],
    subtotal: aries.price,
    discount: 0,
    tax: 57,
    shippingFee: 0,
    total: aries.price + 57,
    shippingAddress: address,
    status: 'pending_payment',
    payment: { method: 'gateway', gateway: 'cashfree', status: 'pending', cfOrderId: 'KS-100003' },
    timeline: [{ status: 'pending_payment', note: 'Placed via cashfree', at: daysAgo(1) }],
  });

  await Order.create({
    orderNumber: 'KS-100004',
    userId: demo._id,
    email: demo.email,
    contactName: demo.name,
    phone: demo.phone,
    items: [snapshot(amethyst, 1)],
    subtotal: amethyst.price,
    discount: 0,
    tax: 75,
    shippingFee: 0,
    total: amethyst.price + 75,
    shippingAddress: address,
    status: 'shipped',
    payment: { method: 'cod', status: 'pending' },
    shipment: { provider: 'ithink', carrier: 'delhivery', waybill: 'SEEDFWD100004', lastStatus: 'In Transit', orderType: 'forward' },
    timeline: [
      { status: 'processing', note: 'Placed via cod', at: daysAgo(6) },
      { status: 'shipped', note: 'iThink booked SEEDFWD100004', at: daysAgo(4) },
    ],
  });

  await ReturnRequest.create({
    orderId: delivered._id,
    userId: demo._id,
    type: 'return',
    reasonCode: 'wrong_product',
    reason: 'Wrong product received',
    items: [{ name: heart.name, productId: heart._id, quantity: 1 }],
    refundAmount: delivered.total,
    status: 'requested',
    timeline: [{ status: 'requested', note: 'Wrong product received', at: daysAgo(1) }],
  });

  welcome.usedCount = 1;
  welcome.discountCost = 130;
  welcome.revenueGenerated = processing.total;
  await welcome.save();
  await CouponUsage.create({
    couponId: welcome._id,
    userId: demo._id,
    orderId: processing._id,
    code: welcome.code,
    discount: 130,
    orderTotal: processing.total,
  });

  await StockAdjustment.insertMany([
    { kind: 'product', productId: heart._id, delta: -1, reason: 'Seed order KS-100001', previousStock: heart.stock + 1, nextStock: heart.stock, userId: admin._id },
    { kind: 'bead', beadId: beads[0]._id, delta: 80, reason: 'Opening bead stock', previousStock: 420, nextStock: 500, userId: admin._id },
  ]);

  await Notification.insertMany([
    { type: 'new_order', title: `Paid order ${delivered.orderNumber}`, body: `${demo.name} · ₹${delivered.total} · COD`, link: '/admin/orders', read: true },
    { type: 'new_customer', title: `New customer ${demo.name}`, body: demo.email, link: '/admin/customers', read: true },
    { type: 'return', title: `Return requested for ${delivered.orderNumber}`, body: 'Wrong product received', link: '/admin/returns', read: false },
    { type: 'contact', title: 'Message from Diya Shah', body: 'Do you make a 7" wrist for the Heart Line Rose bracelet?', link: '/admin/contacts', read: false },
    { type: 'abandoned_cart', title: 'Cart waiting for Aarav Mehta', body: 'Life Path 8 Numerology Strand is still in the bag.', link: '/admin/abandoned-carts', read: false },
  ]);

  await WebhookEvent.insertMany([
    { provider: 'cashfree', eventId: 'seed-cf-ks-100003', eventType: 'PAYMENT_SUCCESS_WEBHOOK', status: 'ignored', ref: 'KS-100003', message: 'Seed placeholder' },
    { provider: 'ithink', eventId: 'seed-it-SEEDFWD100001:Delivered', eventType: 'Delivered', status: 'applied', ref: 'KS-100001', message: 'SEEDFWD100001' },
  ]);

  return { welcome, flat, delivered };
}

module.exports = { seedPlatform };
