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
const { slugifyName } = require('../utils/asyncHandler');
const { seedNumerologyMappings } = require('./seedNumerology');

const DISCLAIMER =
  'These are traditional and spiritual associations, not medical claims. Kuberstones products are not intended to diagnose, treat, or cure any condition.';

const BEADS = [
  {
    name: 'Rose Quartz',
    shortDescriptor: 'The stone of gentle love',
    powerUse: 'Opens the heart to compassion, self-worth and tender connection.',
    benefits: ['Softens emotional walls', 'Invites self-love', 'Supports partnership', 'Calms the heart space'],
    chakra: 'Heart',
    careNotes: 'Cleanse under moonlight. Avoid prolonged harsh sunlight.',
    pricePerBead: 45,
    colorHex: '#E8A0B4',
    image: '/catalog/beads/bead-rose-quartz.jpg',
  },
  {
    name: 'Rhodonite',
    shortDescriptor: 'Balance after heartache',
    powerUse: 'Grounds love in emotional honesty and forgiveness.',
    benefits: ['Heals old wounds', 'Encourages forgiveness', 'Stabilises mood', 'Supports inner worth'],
    chakra: 'Heart',
    careNotes: 'Wipe with a soft cloth. Keep away from chemicals.',
    pricePerBead: 52,
    colorHex: '#C45C6A',
    image: '/catalog/beads/bead-rhodonite.jpg',
  },
  {
    name: 'Strawberry Quartz',
    shortDescriptor: 'Joyful affection',
    powerUse: 'Amplifies love energy with a lighter, optimistic charge.',
    benefits: ['Lifts the spirit', 'Attracts kind attention', 'Supports gratitude', 'Softens self-criticism'],
    chakra: 'Heart',
    careNotes: 'Rinse in lukewarm water. Dry thoroughly.',
    pricePerBead: 48,
    colorHex: '#D96B7B',
    image: '/catalog/beads/bead-strawberry-quartz.jpg',
  },
  {
    name: 'Moonstone',
    shortDescriptor: 'Intuition and new cycles',
    powerUse: 'Aligns with lunar rhythm, intuition and fresh beginnings.',
    benefits: ['Supports new chapters', 'Deepens intuition', 'Eases emotional tides', 'Invites feminine balance'],
    chakra: 'Crown / Sacral',
    careNotes: 'Moonlight cleanse. Handle gently — moonstone can be delicate.',
    pricePerBead: 58,
    colorHex: '#D9D6E8',
    image: '/catalog/beads/bead-moonstone.jpg',
  },
  {
    name: 'Citrine',
    shortDescriptor: 'Merchant’s stone of abundance',
    powerUse: 'Traditionally carried to attract wealth, confidence and sunny momentum.',
    benefits: ['Invites prosperity', 'Boosts optimism', 'Supports decisive action', 'Clears scarcity thinking'],
    chakra: 'Solar Plexus',
    careNotes: 'Sunlight briefly is fine. Avoid harsh chemicals.',
    pricePerBead: 55,
    colorHex: '#E2B84F',
    image: '/catalog/beads/bead-citrine.jpg',
  },
  {
    name: 'Pyrite',
    shortDescriptor: 'Fool’s gold, serious intention',
    powerUse: 'Shields the aura while drawing material opportunity.',
    benefits: ['Attracts opportunity', 'Strengthens will', 'Protects energy', 'Supports ambition'],
    chakra: 'Solar Plexus',
    careNotes: 'Keep dry. Do not soak. Wipe with a dry cloth.',
    pricePerBead: 42,
    colorHex: '#C4B45A',
    image: '/catalog/beads/bead-pyrite.jpg',
  },
  {
    name: 'Green Aventurine',
    shortDescriptor: 'Luck and gentle growth',
    powerUse: 'Opens pathways for opportunity, heart-led luck and steady gain.',
    benefits: ['Invites luck', 'Soothes anxiety around money', 'Supports growth', 'Balances the heart'],
    chakra: 'Heart',
    careNotes: 'Water-safe for brief rinses. Recharge on a quartz cluster.',
    pricePerBead: 38,
    colorHex: '#3E8F6B',
    image: '/catalog/beads/bead-green-aventurine.jpg',
  },
  {
    name: 'Tiger Eye',
    shortDescriptor: 'Courage and shrewd focus',
    powerUse: 'Grounds confidence, sharp judgment and practical success.',
    benefits: ['Sharpens focus', 'Builds courage', 'Supports smart decisions', 'Anchors confidence'],
    chakra: 'Solar Plexus / Root',
    careNotes: 'Wipe clean. Avoid ultrasonic cleaners.',
    pricePerBead: 40,
    colorHex: '#A86B2D',
    image: '/catalog/beads/bead-tiger-eye.jpg',
  },
  {
    name: 'Amethyst',
    shortDescriptor: 'Calm, clarity, higher mind',
    powerUse: 'Quiets mental noise and supports spiritual alignment.',
    benefits: ['Calms the mind', 'Aids restful sleep', 'Supports intuition', 'Softens overwhelm'],
    chakra: 'Crown / Third Eye',
    careNotes: 'Avoid long sun exposure to preserve colour.',
    pricePerBead: 50,
    colorHex: '#7B4BB3',
    image: '/catalog/beads/bead-amethyst.jpg',
  },
  {
    name: 'Black Tourmaline',
    shortDescriptor: 'Protection and grounding',
    powerUse: 'Creates a felt boundary against dense or scattered energy.',
    benefits: ['Grounds the body', 'Supports energetic boundaries', 'Calms hypervigilance', 'Anchors presence'],
    chakra: 'Root',
    careNotes: 'Rinse and rest on the earth or a bed of salt (not wet salt on the bracelet).',
    pricePerBead: 36,
    colorHex: '#1A1A1C',
    image: '/catalog/beads/bead-black-tourmaline.jpg',
  },
  {
    name: 'Clear Quartz',
    shortDescriptor: 'Master amplifier',
    powerUse: 'Clarifies intention and amplifies neighbouring stones.',
    benefits: ['Amplifies intention', 'Clears mental fog', 'Balances energy', 'Supports programming'],
    chakra: 'Crown / All',
    careNotes: 'Smoke, sound or moonlight cleanse. Program with a spoken intention.',
    pricePerBead: 32,
    colorHex: '#F2F0EA',
    image: '/catalog/beads/bead-clear-quartz.jpg',
  },
  {
    name: 'Carnelian',
    shortDescriptor: 'Vital fire',
    powerUse: 'Stirs courage, creativity and physical vitality.',
    benefits: ['Boosts vitality', 'Supports motivation', 'Warms creativity', 'Anchors confidence'],
    chakra: 'Sacral',
    careNotes: 'Avoid sudden temperature shock.',
    pricePerBead: 34,
    colorHex: '#C65A32',
    image: '/catalog/beads/bead-carnelian.jpg',
  },
  {
    name: 'Lapis Lazuli',
    shortDescriptor: 'Voice of truth',
    powerUse: 'Opens honest expression and inner authority.',
    benefits: ['Supports clear speech', 'Deepens self-trust', 'Invites wisdom', 'Calms throat tension'],
    chakra: 'Throat / Third Eye',
    careNotes: 'Keep away from acids and long water soaks.',
    pricePerBead: 62,
    colorHex: '#2E4C9A',
    image: '/catalog/beads/bead-lapis-lazuli.jpg',
  },
  {
    name: 'Labradorite',
    shortDescriptor: 'Magic and protection of the unseen',
    powerUse: 'Shields the aura while awakening insight and new paths.',
    benefits: ['Protects sensitivity', 'Supports transformation', 'Awakens intuition', 'Invites synchronicity'],
    chakra: 'Third Eye',
    careNotes: 'Moonlight preferred. Handle flash surfaces with care.',
    pricePerBead: 54,
    colorHex: '#3D5C6E',
    image: '/catalog/beads/bead-labradorite.jpg',
  },
  {
    name: 'Garnet',
    shortDescriptor: 'Rooted passion',
    powerUse: 'Restores stamina, devotion and grounded desire.',
    benefits: ['Rebuilds energy', 'Supports commitment', 'Grounds passion', 'Warms circulation of will'],
    chakra: 'Root',
    careNotes: 'Durable; still avoid harsh knocks.',
    pricePerBead: 46,
    colorHex: '#7A1F2B',
    image: '/catalog/beads/bead-garnet.jpg',
  },
  {
    name: 'Sodalite',
    shortDescriptor: 'Logic meeting intuition',
    powerUse: 'Steadies thought and truthful communication.',
    benefits: ['Clarifies thinking', 'Supports study', 'Calms mental chatter', 'Encourages honest talk'],
    chakra: 'Throat / Third Eye',
    careNotes: 'Wipe clean. Avoid salt water.',
    pricePerBead: 35,
    colorHex: '#3A4F8C',
    image: '/catalog/beads/bead-sodalite.jpg',
  },
];

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
    return ['Lapis Lazuli', 'Sodalite', 'Blue Lace placeholder', 'Clear Quartz'].filter((n) => n !== 'Blue Lace placeholder');
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
  ]);

  const adminHash = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'Admin@123', 10);
  const demoHash = await bcrypt.hash('Demo@123', 10);

  const admin = await User.create({
    name: 'Kuberstones Admin',
    email: process.env.ADMIN_EMAIL || 'admin@kuberstones.com',
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

  await Product.insertMany([
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
      colorHex: '#C65A32',
      images: ['/catalog/products/aries-fire-bracelet.jpg'],
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
      colorHex: '#E2B84F',
      images: ['/catalog/products/life-path-8-numerology-strand.jpg'],
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
      colorHex: '#E8A0B4',
      images: ['/catalog/products/heart-line-rose-bracelet.jpg'],
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
      colorHex: '#6B3A1E',
      images: ['/catalog/products/five-mukhi-rudraksha-bracelet.jpg'],
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
      colorHex: '#7B4BB3',
      images: ['/catalog/products/amethyst-calm-strand.jpg'],
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
      colorHex: '#2E4C9A',
      images: ['/catalog/products/lapis-statement-bracelet.jpg'],
    },
  ]);

  const beadDocs = await Bead.insertMany(
    BEADS.map((b) => ({
      ...b,
      slug: slugifyName(b.name),
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
      finishes: [{ key: 'gold', label: 'Gold', price: 299, metalColor: '#D4AF37' }],
    },
    {
      name: 'Om',
      slug: 'om',
      description: 'The Om charm — a quiet seal at the clasp.',
      isActive: true,
      finishes: [{ key: 'gold', label: 'Gold', price: 299, metalColor: '#E8D5A3' }],
    },
  ]);

  await BraceletConfig.create({
    beadLimit: 18,
    minBeads: 1,
    baseMakingPrice: 499,
    wristSizes: ['5.5"', '6"', '6.5"', '7"', '7.5"', '8"'],
    defaultWristSize: '6.5"',
    zodiacBeadCount: 2,
  });

  await SiteContent.create({
    key: 'main',
    hero: {
      eyebrow: 'ENERGY • ABUNDANCE • WELLNESS',
      title: 'Heal. Align. Attract abundance.',
      subtitle: 'Choose a purpose, then an intention. Your crystals are calibrated from your Mulank and finished with zodiac beads and a name.',
    },
    about: {
      headline: 'Jewellery as a quiet ritual',
      tagline: 'Editorial luxury for modern seekers.',
      body: 'Kuberstones is a contemporary jewellery house working with crystals, rudraksha and gemstones. Customize Your Bracelet is the heart of the brand: you choose a purpose and intention, we place the crystals from your Mulank calibration, add zodiac beads, then engrave the name you give the piece.\n\nEvery recommendation is tied to a traditional association, written in plain language. We do not make medical claims.',
    },
    trustClaims: [
      { title: 'Natural & Authentic', body: 'Stones are selected for quality and character. We describe them honestly.' },
      { title: 'Designed for Intentions', body: 'Purpose, intention and bead are linked in our master data — never guessed at checkout.' },
      { title: 'Handmade', body: 'Each custom strand is made to your bead count, wrist size and charm finish.' },
      { title: 'Energized / Cleansed', body: 'Pieces are prepared in-house with our standard cleanse ritual before dispatch.' },
      { title: 'Secure Payments', body: 'Encrypted checkout will be enabled in the next release. Orders today are held as pending payment.' },
    ],
    testimonials: [
      {
        quote: 'The Mulank calibration felt considered. I wear it every day and it still feels made for me — not picked from a tray.',
        name: 'Ananya M.',
        place: 'Mumbai',
        piece: 'Customization · Love',
        media: '/catalog/products/heart-line-rose-bracelet.jpg',
      },
      {
        quote: 'I asked for abundance and they did not oversell it. Citrine and pyrite sit quietly on the wrist. That is what I wanted.',
        name: 'Rohan S.',
        place: 'Bengaluru',
        piece: 'Customization · Money',
        media: '/catalog/products/life-path-8-numerology-strand.jpg',
      },
      {
        quote: 'The atelier tone is rare. Packaging, engraving, the note — all of it felt like a house, not a catalogue.',
        name: 'Meera K.',
        place: 'Delhi',
        piece: 'Rudraksha house',
        media: '/catalog/products/five-mukhi-rudraksha-bracelet.jpg',
      },
    ],
  });

  console.log('Seed complete.');
  console.log(`Admin: ${admin.email} / ${process.env.ADMIN_PASSWORD || 'Admin@123'}`);
  console.log('Customer: demo@kuberstones.com / Demo@123');
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
