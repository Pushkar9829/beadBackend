require('dotenv').config();
const bcrypt = require('bcryptjs');
const { connectDb } = require('../config/db');
const User = require('../models/User');
const Category = require('../models/Category');
const Product = require('../models/Product');
const Bead = require('../models/Bead');
const Purpose = require('../models/Purpose');
const Intention = require('../models/Intention');
const IntentionBead = require('../models/IntentionBead');
const Charm = require('../models/Charm');
const BraceletConfig = require('../models/BraceletConfig');
const SiteContent = require('../models/SiteContent');
const Cart = require('../models/Cart');
const MulankCrystal = require('../models/MulankCrystal');
const ZodiacBead = require('../models/ZodiacBead');
const StudioLayer = require('../models/StudioLayer');
const { slugifyName } = require('../utils/asyncHandler');
const StoreSettings = require('../models/StoreSettings');
const Collection = require('../models/Collection');
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
const WebhookEvent = require('../models/WebhookEvent');
const { seedNumerologyMappings } = require('./seedNumerology');
const { seedPlatform } = require('./seedPlatform');
const { HOME_DEFAULTS } = require('../data/homeContent');
const { catalogPriceFor } = require('../data/beadPriceSource');
const { ensureStudioLayers } = require('./ensureStudioLayers');
const { uploadSeedMedia } = require('./uploadSeedMedia');
const { assertDestructiveAllowed, randomPassword } = require('./destructiveGuard');
const { MIN_ADMIN_PASSWORD_LENGTH } = require('./ensureAuthAccounts');

const DISCLAIMER =
  'These are traditional and spiritual associations, not medical claims. Kuberstones products are not intended to diagnose, treat, or cure any condition.';

const { BEADS } = require('../data/catalogBeads');

const PURPOSES = [
  { name: 'Love & Relationships', description: 'Invite tenderness, partnership and self-worth.' },
  { name: 'Money & Abundance', description: 'Align with wealth, flow and material ease.' },
  { name: 'Career & Success', description: 'Support ambition, recognition and skilled work.' },
  { name: 'Confidence & Power', description: 'Stand in your voice, will and presence.' },
  { name: 'Protection & Grounding', description: 'Feel held, bounded and rooted.' },
  { name: 'Focus & Clarity', description: 'Quiet noise so decisions feel clean.' },
  { name: 'Calm & Emotional Balance', description: 'Soften intensity and restore evenness.' },
  { name: 'Sleep & Relaxation', description: 'Unwind the nervous system toward rest.' },
  { name: 'Energy & Vitality', description: 'Rekindle stamina and everyday aliveness.' },
  { name: 'Spiritual Growth', description: 'Deepen practice, insight and inner listening.' },
  { name: 'New Beginnings', description: 'Mark a threshold with intention.' },
  { name: 'Communication & Expression', description: 'Speak with clarity and heart.' },
  { name: 'Overall Balance', description: 'A whole-bracelet composition for harmony.' },
];

const MONEY_INTENTIONS = [
  'Attract Wealth',
  'Financial Freedom',
  'Increase Income',
  'Business Success',
  'Smart Investments',
  'Money Flow',
  'Debt Relief',
  'Savings Growth',
  'Career Advancement',
  'Prosperity Mindset',
  'Opportunities',
  'Material Comfort',
];

const OTHER_INTENTIONS = {
  'Love & Relationships': ['Open the Heart', 'Attract Partnership', 'Self-Love', 'Heal After Heartache'],
  'Career & Success': ['Recognition at Work', 'Leadership Presence', 'Creative Success'],
  'Confidence & Power': ['Inner Authority', 'Courage in Rooms'],
  'Protection & Grounding': ['Daily Shield', 'Rooted Presence'],
  'Focus & Clarity': ['Study & Decisions', 'Mental Stillness'],
  'Calm & Emotional Balance': ['Soothe Anxiety', 'Even Mood'],
  'Sleep & Relaxation': ['Night Unwind', 'Gentle Rest'],
  'Energy & Vitality': ['Morning Drive', 'Recover Stamina'],
  'Spiritual Growth': ['Deepen Practice', 'Intuitive Listening'],
  'New Beginnings': ['Clean Slate', 'Threshold Ritual'],
  'Communication & Expression': ['Speak Truth', 'Creative Voice'],
  'Overall Balance': ['Harmony Composition', 'Daily Alignment'],
};

function beadNamesForIntention(intentionName, purposeName) {
  if (purposeName === 'Money & Abundance' || /wealth|income|business|invest|money|debt|saving|career|prosper|opportunit|comfort|freedom/i.test(intentionName)) {
    return ['Citrine', 'Pyrite', 'Green Aventurine', 'Tiger Eye', 'Clear Quartz'];
  }
  if (purposeName === 'Love & Relationships' || /heart|love|partner/i.test(intentionName)) {
    return ['Rose Quartz', 'Rhodonite', 'Strawberry Quartz', 'Moonstone'];
  }
  if (/protect|ground|shield|root/i.test(intentionName) || purposeName === 'Protection & Grounding') {
    return ['Black Tourmaline', 'Tiger Eye', 'Garnet', 'Clear Quartz'];
  }
  if (/sleep|calm|relax|soothe|balance|anxiety/i.test(intentionName) || /Calm|Sleep/.test(purposeName)) {
    return ['Amethyst', 'Moonstone', 'Rose Quartz', 'Sodalite'];
  }
  if (/focus|clarity|study|decision/i.test(intentionName) || purposeName === 'Focus & Clarity') {
    return ['Sodalite', 'Clear Quartz', 'Tiger Eye', 'Lapis Lazuli'];
  }
  if (/energy|vital|stamina|fire/i.test(intentionName) || purposeName === 'Energy & Vitality') {
    return ['Carnelian', 'Garnet', 'Tiger Eye', 'Citrine'];
  }
  if (/spiritual|intuit|practice|magic/i.test(intentionName) || purposeName === 'Spiritual Growth') {
    return ['Amethyst', 'Labradorite', 'Moonstone', 'Clear Quartz'];
  }
  if (/communicat|speak|voice|express/i.test(intentionName) || purposeName === 'Communication & Expression') {
    return ['Lapis Lazuli', 'Sodalite', 'Blue Lace Agate', 'Clear Quartz'];
  }
  if (/begin|slate|threshold|new/i.test(intentionName) || purposeName === 'New Beginnings') {
    return ['Moonstone', 'Clear Quartz', 'Citrine', 'Labradorite'];
  }
  if (/confidence|power|authority|courage|leadership/i.test(intentionName) || /Confidence|Career/.test(purposeName)) {
    return ['Tiger Eye', 'Carnelian', 'Pyrite', 'Garnet'];
  }
  return ['Clear Quartz', 'Amethyst', 'Citrine', 'Rose Quartz'];
}

function reasonFor(beadName, intentionName) {
  return `${beadName} is recommended for “${intentionName}” in the Kuberstones tradition: its historic association is used here to keep your bracelet aligned with that intention — not as a medical promise.`;
}

async function run() {
  // Destructive: wipes ~35 collections. Guarded against production / remote databases.
  assertDestructiveAllowed('seed', 'DELETE ALL documents in ~35 collections (users, orders, catalog, content…) and re-seed demo data');
  await connectDb();
  console.log('Seeding Kuberstones…');

  await Promise.all([
    User.deleteMany({}),
    Category.deleteMany({}),
    Product.deleteMany({}),
    Bead.deleteMany({}),
    Purpose.deleteMany({}),
    Intention.deleteMany({}),
    IntentionBead.deleteMany({}),
    Charm.deleteMany({}),
    BraceletConfig.deleteMany({}),
    SiteContent.deleteMany({}),
    Cart.deleteMany({}),
    MulankCrystal.deleteMany({}),
    ZodiacBead.deleteMany({}),
    StudioLayer.deleteMany({}),
    StoreSettings.deleteMany({}),
    Collection.deleteMany({}),
    Attribute.deleteMany({}),
    Coupon.deleteMany({}),
    CouponUsage.deleteMany({}),
    Offer.deleteMany({}),
    FlashSale.deleteMany({}),
    Banner.deleteMany({}),
    Faq.deleteMany({}),
    BlogPost.deleteMany({}),
    Pincode.deleteMany({}),
    CustomerGroup.deleteMany({}),
    Newsletter.deleteMany({}),
    ContactMessage.deleteMany({}),
    Media.deleteMany({}),
    Wishlist.deleteMany({}),
    Notification.deleteMany({}),
    StockAdjustment.deleteMany({}),
    Order.deleteMany({}),
    ReturnRequest.deleteMany({}),
    WebhookEvent.deleteMany({}),
  ]);

  // Never use hardcoded credentials and never print passwords.
  const envAdminPassword = String(process.env.ADMIN_PASSWORD || '');
  const adminPasswordGenerated = envAdminPassword.length < MIN_ADMIN_PASSWORD_LENGTH;
  if (envAdminPassword && adminPasswordGenerated) {
    console.warn(`ADMIN_PASSWORD is shorter than ${MIN_ADMIN_PASSWORD_LENGTH} characters; ignoring it.`);
  }
  const adminHash = await bcrypt.hash(adminPasswordGenerated ? randomPassword() : envAdminPassword, 10);
  const demoPasswordGenerated = !process.env.DEMO_PASSWORD;
  const demoHash = await bcrypt.hash(process.env.DEMO_PASSWORD || randomPassword(), 10);

  const admin = await User.create({
    name: 'Kuberstones Admin',
    email: String(process.env.ADMIN_EMAIL || 'admin@kuberstones.com').toLowerCase().trim(),
    passwordHash: adminHash,
    role: 'admin',
    phone: '9999999999',
  });
  const demo = await User.create({
    name: 'Aarav Mehta',
    email: 'demo@kuberstones.com',
    passwordHash: demoHash,
    role: 'customer',
    phone: '9888888888',
    addresses: [
      {
        label: 'Home',
        line1: '12 Lotus Lane',
        city: 'Mumbai',
        state: 'Maharashtra',
        pincode: '400001',
        country: 'India',
        isDefault: true,
      },
    ],
  });
  await Cart.create({ userId: admin._id, items: [] });
  await Cart.create({ userId: demo._id, items: [] });

  const crystalsRoot = await Category.create({
    name: 'Crystals',
    slug: 'crystals',
    family: 'crystals',
    description: 'Crystal bracelet collections and crystal-based pieces.',
    sortOrder: 1,
  });
  const rudrakshaRoot = await Category.create({
    name: 'Rudraksha',
    slug: 'rudraksha',
    family: 'rudraksha',
    description: 'Rudraksha collections and related spiritual jewellery.',
    sortOrder: 2,
  });
  const gemstonesRoot = await Category.create({
    name: 'Gemstones',
    slug: 'gemstones',
    family: 'gemstones',
    description: 'Gemstone jewellery and bracelet collections.',
    sortOrder: 3,
  });

  const crystalChildren = await Category.insertMany([
    {
      name: 'Zodiac Bracelets',
      slug: 'zodiac-bracelets',
      family: 'crystals',
      parentId: crystalsRoot._id,
      description: 'Pieces composed around zodiac correspondences.',
      sortOrder: 1,
    },
    {
      name: 'Numerology Bracelets',
      slug: 'numerology-bracelets',
      family: 'crystals',
      parentId: crystalsRoot._id,
      description: 'Collections guided by number and personal year.',
      sortOrder: 2,
    },
    {
      name: 'Customize Your Bracelet',
      slug: 'customize-your-bracelet',
      family: 'crystals',
      parentId: crystalsRoot._id,
      description: 'Build a personal piece by purpose and intention.',
      sortOrder: 3,
    },
  ]);

  await Category.insertMany([
    {
      name: 'Five Mukhi',
      slug: 'five-mukhi',
      family: 'rudraksha',
      parentId: rudrakshaRoot._id,
      sortOrder: 1,
      description: 'Classic five-mukhi malas and bracelets.',
    },
    {
      name: 'Bracelet Strands',
      slug: 'rudraksha-bracelet-strands',
      family: 'rudraksha',
      parentId: rudrakshaRoot._id,
      sortOrder: 2,
    },
    {
      name: 'Precious Cuts',
      slug: 'precious-cuts',
      family: 'gemstones',
      parentId: gemstonesRoot._id,
      sortOrder: 1,
    },
    {
      name: 'Semi-Precious Bracelets',
      slug: 'semi-precious-bracelets',
      family: 'gemstones',
      parentId: gemstonesRoot._id,
      sortOrder: 2,
    },
  ]);

  const productDocs = await Product.insertMany([
    {
      name: 'Aries Fire Bracelet',
      slug: 'aries-fire-bracelet',
      family: 'crystals',
      categoryId: crystalChildren[0]._id,
      description: 'A ready composition of carnelian, garnet and clear quartz for Aries season energy. Handmade strand with our standard making finish.',
      shortDescription: 'Carnelian • Garnet • Clear Quartz',
      price: 1899,
      compareAtPrice: 2299,
      stock: 12,
      featured: true,
      featuredSort: 1,
      sku: 'KS-ARIES-01',
      rating: 4.9,
      reviewCount: 128,
      colorHex: '#C65A32',
      images: ['/catalog/products/aries-fire-bracelet.jpg'],
      attributes: { chakra: 'Sacral', origin: 'India' },
    },
    {
      name: 'Life Path 8 Numerology Strand',
      slug: 'life-path-8-numerology-strand',
      family: 'crystals',
      categoryId: crystalChildren[1]._id,
      description: 'Citrine, pyrite and tiger eye arranged for the material-mastery number.',
      shortDescription: 'Citrine • Pyrite • Tiger Eye',
      price: 2199,
      stock: 8,
      featured: true,
      featuredSort: 2,
      sku: 'KS-LP8-01',
      rating: 4.8,
      reviewCount: 86,
      colorHex: '#E2B84F',
      images: ['/catalog/products/life-path-8-numerology-strand.jpg'],
      attributes: { chakra: 'Solar Plexus', origin: 'India' },
    },
    {
      name: 'Heart Line Rose Bracelet',
      slug: 'heart-line-rose-bracelet',
      family: 'crystals',
      categoryId: crystalChildren[0]._id,
      description: 'Rose quartz with moonstone for a softer daily wear piece.',
      shortDescription: 'Rose Quartz • Moonstone',
      price: 1699,
      stock: 20,
      featured: true,
      featuredSort: 3,
      sku: 'KS-HEART-01',
      rating: 5,
      reviewCount: 214,
      colorHex: '#E8A0B4',
      images: ['/catalog/products/heart-line-rose-bracelet.jpg'],
      attributes: { chakra: 'Heart', origin: 'India' },
    },
    {
      name: 'Five Mukhi Rudraksha Bracelet',
      slug: 'five-mukhi-rudraksha-bracelet',
      family: 'rudraksha',
      categoryId: rudrakshaRoot._id,
      description: 'A classic five-mukhi rudraksha bracelet, hand-strung, for daily wear.',
      shortDescription: 'Five Mukhi • Handmade',
      price: 1299,
      stock: 30,
      featured: true,
      featuredSort: 4,
      sku: 'KS-RUD-5M',
      rating: 4.9,
      reviewCount: 341,
      colorHex: '#6B3A1E',
      images: ['/catalog/products/five-mukhi-rudraksha-bracelet.jpg'],
      attributes: { origin: 'India' },
    },
    {
      name: 'Amethyst Calm Strand',
      slug: 'amethyst-calm-strand',
      family: 'gemstones',
      categoryId: gemstonesRoot._id,
      description: 'Faceted amethyst bracelet with a discreet gold-tone clasp.',
      shortDescription: 'Amethyst • Gold-tone clasp',
      price: 2499,
      stock: 10,
      featured: true,
      featuredSort: 5,
      sku: 'KS-AMY-01',
      rating: 4.7,
      reviewCount: 92,
      colorHex: '#7B4BB3',
      images: ['/catalog/products/amethyst-calm-strand.jpg'],
      attributes: { chakra: 'Crown', origin: 'India' },
    },
    {
      name: 'Lapis Statement Bracelet',
      slug: 'lapis-statement-bracelet',
      family: 'gemstones',
      categoryId: gemstonesRoot._id,
      description: 'Deep lapis lazuli beads for presence and voice.',
      shortDescription: 'Lapis Lazuli',
      price: 2799,
      stock: 6,
      featured: false,
      sku: 'KS-LAPIS-01',
      rating: 5,
      reviewCount: 47,
      colorHex: '#2E4C9A',
      images: ['/catalog/products/lapis-statement-bracelet.jpg'],
      attributes: { chakra: 'Throat', origin: 'India' },
    },
  ]);

  const beadDocs = await Bead.insertMany(
    BEADS.map((b) => ({
      ...b,
      slug: slugifyName(b.name),
      pricePerBead: catalogPriceFor(b.name) ?? b.pricePerBead,
      disclaimer: DISCLAIMER,
      stock: 500,
      isActive: true,
      textureUrl: b.image,
    }))
  );
  const beadByName = Object.fromEntries(beadDocs.map((b) => [b.name, b]));

  const purposeDocs = await Purpose.insertMany(
    PURPOSES.map((p, i) => ({
      ...p,
      slug: slugifyName(p.name),
      sortOrder: i + 1,
      isActive: true,
    }))
  );
  const purposeByName = Object.fromEntries(purposeDocs.map((p) => [p.name, p]));

  const intentionPayload = [];
  purposeDocs.forEach((p) => {
    const names = p.name === 'Money & Abundance' ? MONEY_INTENTIONS : OTHER_INTENTIONS[p.name] || ['General Alignment'];
    names.forEach((name, i) => {
      intentionPayload.push({
        purposeId: p._id,
        name,
        slug: slugifyName(`${p.name}-${name}`),
        description: `Selected when your purpose is ${p.name.toLowerCase()} and you want to work with ${name.toLowerCase()}.`,
        sortOrder: i + 1,
        isActive: true,
      });
    });
  });
  const intentionDocs = await Intention.insertMany(intentionPayload);

  const mappings = [];
  intentionDocs.forEach((intn) => {
    const purpose = purposeDocs.find((p) => String(p._id) === String(intn.purposeId));
    const names = beadNamesForIntention(intn.name, purpose.name);
    names.forEach((beadName, i) => {
      const bead = beadByName[beadName];
      if (!bead) return;
      mappings.push({
        intentionId: intn._id,
        beadId: bead._id,
        reason: reasonFor(bead.name, intn.name),
        sortOrder: i + 1,
      });
    });
  });
  await IntentionBead.insertMany(mappings);
  await seedNumerologyMappings(beadByName);

  await Charm.create([
    {
      name: 'Sriyantra',
      slug: 'sriyantra',
      description: 'The Sriyantra charm — geometry of abundance at the clasp.',
      isActive: true,
      finishes: [{ key: 'gold', label: 'Gold', price: 0, metalColor: '#D4AF37' }],
    },
    {
      name: 'Om',
      slug: 'om',
      description: 'The Om charm — a quiet seal at the clasp.',
      isActive: true,
      finishes: [{ key: 'gold', label: 'Gold', price: 0, metalColor: '#E8D5A3' }],
    },
  ]);

  await BraceletConfig.create({
    beadLimit: 32,
    minBeads: 1,
    baseMakingPrice: 0,
    wristSizes: ['5.5"', '6"', '6.5"', '7"', '7.5"', '8"'],
    defaultWristSize: '6.5"',
    beadSizesMm: [6, 8, 10],
    defaultBeadSizeMm: 8,
    packaging: {
      box: 44,
      clasp: 10,
      charm: 60,
      cz: 6,
      roundCz: 8,
      thread: 20,
    },
    zodiacBeadCount: 2,
  });

  await SiteContent.create({
    key: 'main',
    ...HOME_DEFAULTS,
  });

  await seedPlatform({
    admin,
    demo,
    products: productDocs,
    beads: beadDocs,
  });

  await ensureStudioLayers();

  console.log('Uploading catalog / purpose / home images to S3…');
  const mediaResult = await uploadSeedMedia();
  console.log('Seed media:', mediaResult);

  console.log('Seed complete. Catalog, customizer, and store models are filled.');
  console.log(`Admin account: ${admin.email}`);
  if (adminPasswordGenerated) {
    console.log('  Admin password was randomly generated (not shown). Set ADMIN_PASSWORD (12+ chars) and re-seed, or reset it via the password-reset flow.');
  } else {
    console.log('  Admin password taken from ADMIN_PASSWORD.');
  }
  console.log(`Customer account: ${demo.email}`);
  if (demoPasswordGenerated) {
    console.log('  Demo password was randomly generated (not shown). Set DEMO_PASSWORD to choose one.');
  }
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
