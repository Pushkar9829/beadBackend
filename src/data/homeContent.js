const { PAGES_DEFAULTS, FOOTER_DEFAULTS, CONTACT_DEFAULTS } = require('./sitePages');
const { mergeHomeLayout } = require('./homeLayout');

const ICON_FROM_TITLE = {
  'Natural & Authentic': 'gem',
  'Designed for Intentions': 'sparkles',
  Handmade: 'hand',
  'Energized / Cleansed': 'sparkles',
  'Secure Payments': 'shield',
};

const HOME_DEFAULTS = {
  hero: {
    eyebrow: 'Energy · Abundance · Wellness',
    brandName: 'Kuberstones',
    title: 'Heal. Align. Attract abundance.',
    subtitle: 'Build a personal bracelet from purpose and intention — every crystal chosen with a reason.',
    image: '',
    imageAlt: 'Handmade crystal bracelet on the wrist',
    primaryCta: { label: 'Customization', to: '/customize' },
    secondaryCta: { label: 'Shop All', to: '/shop' },
  },
  marquee: [
    'Energy',
    'Abundance',
    'Wellness',
    'Crystals',
    'Rudraksha',
    'Gemstones',
    'Customization',
    'Handmade',
  ],
  houses: {
    eyebrow: 'The atelier',
    title: 'Three houses',
    body: 'Every collection lives in one of three houses. Enter any of them — or begin in the studio and compose a strand of your own.',
    items: [
      {
        slug: 'crystals',
        name: 'Crystals',
        roman: 'I',
        blurb: 'Strands composed for intention — colour, count, and character held with restraint.',
        image: '',
        cta: 'Enter the house →',
      },
      {
        slug: 'rudraksha',
        name: 'Rudraksha',
        roman: 'II',
        blurb: 'Sacred seed jewellery, quiet in silhouette and exact in its making.',
        image: '',
        cta: 'Enter the house →',
      },
      {
        slug: 'gemstones',
        name: 'Gemstones',
        roman: 'III',
        blurb: 'Cut stones and bracelet collections, set for light rather than noise.',
        image: '',
        cta: 'Enter the house →',
      },
    ],
  },
  studio: {
    eyebrow: 'The studio',
    title: 'Customization',
    body: 'Choose a purpose, then an intention. Crystals are placed from your Mulank, then closed with a Sriyantra or Om charm.',
    action: 'Open the studio →',
    to: '/customize',
    bannerImage: '',
    kicker: 'Begin a strand',
    heading: 'Compose your bracelet',
    copy: 'Purpose, intention, Mulank, zodiac, and a name — made to your wrist, not picked from a tray.',
    cta: 'Open the studio →',
  },
  ritual: {
    eyebrow: 'The ritual',
    title: 'How a strand is made',
    body: 'Four steps. No catalogue guesswork — the bracelet is composed in sequence, then made by hand.',
    steps: [
      { n: '01', title: 'Purpose', body: 'Begin with why you wear it — calm, abundance, protection, or love.' },
      { n: '02', title: 'Intention', body: 'Choose the feeling. Its crystals are selected for you, not guessed at checkout.' },
      { n: '03', title: 'Calibration', body: 'Your date of birth sets the Mulank. Counts are composed to that number.' },
      { n: '04', title: 'Charm', body: 'Sriyantra or Om at the clasp, on Korean elastic or sized steel core.' },
    ],
  },
  featured: {
    eyebrow: 'The collection',
    title: 'Featured pieces',
    body: 'Ready-made works from the three houses — for those who wish to choose rather than compose.',
    action: 'Shop all →',
    to: '/shop',
  },
  brand: {
    name: 'KUBERSTONES',
    tagline: 'Personalized With Purpose',
    logo: '',
    customizeLabel: 'Customization',
    collectionsLabel: 'Collections',
    shopAllLabel: 'Shop All',
  },
  purpose: {
    eyebrow: 'Purpose',
    title: 'Shop by purpose',
    body: 'Begin with why you wear it. Each purpose opens the studio with that intention already chosen.',
    action: 'All purposes →',
    to: '/customize/purpose',
    pageEyebrow: 'Studio',
    pageTitle: 'Shop by purpose',
    pageBody: 'Choose the reason first. The studio then places crystals for that intention.',
  },
  rails: {
    bestsellers: { eyebrow: 'Collection', title: 'Best sellers', action: 'See all →', to: '/collection/best-sellers' },
    newArrivals: { eyebrow: 'Collection', title: 'New arrivals', action: 'See all →', to: '/collection/new-arrivals' },
    trending: { eyebrow: 'Collection', title: 'Trending bracelets', action: 'See all →', to: '/collection/trending' },
  },
  faq: {
    eyebrow: 'FAQ',
    title: 'Questions, answered',
    action: 'All questions →',
    to: '/faq',
    pageEyebrow: 'Care',
    pageTitle: 'Questions, answered quietly.',
    pageBody: '',
    emptyBody: 'No questions published yet.',
  },
  journal: {
    eyebrow: 'Journal',
    title: 'From the atelier',
    action: 'All notes →',
    to: '/journal',
    pageEyebrow: 'Journal',
    pageTitle: 'From the atelier',
    pageBody: 'Quiet writing on stones, ritual, and making.',
    emptyBody: 'No journal entries yet.',
  },
  flash: {
    label: 'Flash sale',
    body: 'Timed prices on a short list. When the clock ends, the atelier rate returns.',
    action: 'Shop the sale →',
    to: '/sale',
    pageBody: 'Timed prices. When the clock ends, the list returns to the atelier rate.',
    emptyTitle: 'No sale is running.',
    emptyBody: 'When a flash sale is live, timed prices will appear here.',
    emptyProducts: 'Products for this sale are being placed.',
  },
  newsletter: {
    eyebrow: 'The list',
    title: 'Quiet notes from the atelier.',
    compactTitle: 'The list.',
  },
  voices: {
    eyebrow: 'Voices',
    title: 'From those who wear it',
    body: 'Quiet notes from custom strands and the three houses — written without medical claims.',
  },
  testimonials: [
    {
      quote:
        'The Mulank calibration felt considered. I wear it every day and it still feels made for me — not picked from a tray.',
      name: 'Ananya M.',
      place: 'Mumbai',
      piece: 'Customization · Love',
      media: '/catalog/products/heart-line-rose-bracelet.jpg',
    },
    {
      quote:
        'I asked for abundance and they did not oversell it. Citrine and pyrite sit quietly on the wrist. That is what I wanted.',
      name: 'Rohan S.',
      place: 'Bengaluru',
      piece: 'Customization · Money',
      media: '/catalog/products/life-path-8-numerology-strand.jpg',
    },
    {
      quote:
        'The atelier tone is rare. Packaging, engraving, the note — all of it felt like a house, not a catalogue.',
      name: 'Meera K.',
      place: 'Delhi',
      piece: 'Rudraksha house',
      media: '/catalog/products/five-mukhi-rudraksha-bracelet.jpg',
    },
  ],
  trust: {
    eyebrow: 'The house',
    title: 'Why Kuberstones',
    body: 'Crystal associations are traditional and spiritual. They are not medical claims. The making, however, is exact.',
  },
  trustClaims: [
    { icon: 'gem', title: 'Natural & Authentic', body: 'Stones are selected for quality and character. We describe them honestly.' },
    { icon: 'sparkles', title: 'Designed for Intentions', body: 'Purpose, intention and bead are linked in our master data — never guessed at checkout.' },
    { icon: 'hand', title: 'Handmade', body: 'Each custom strand is made to your bead count, wrist size and charm finish.' },
    { icon: 'sparkles', title: 'Energized / Cleansed', body: 'Pieces are prepared in-house with our standard cleanse ritual before dispatch.' },
    { icon: 'shield', title: 'Secure Payments', body: 'Pay online through Cashfree, UPI, or cash on delivery where the pincode allows it.' },
  ],
  finale: {
    image: '',
    kicker: 'Begin',
    title: 'A bracelet with a reason.',
    copy: 'Start with a purpose in the studio, or walk the three houses until a piece finds you.',
    primaryCta: { label: 'Customization', to: '/customize' },
    secondaryCta: { label: 'Shop All', to: '/shop' },
  },
  about: {
    eyebrow: 'Kuberstones',
    headline: 'Personalized Spirituality, Designed Around You',
    tagline: 'A brand by Nexxgenn Technology',
    intro: [
      'Kuberstones, a brand by Nexxgenn Technology, is a modern D2C spiritual lifestyle brand offering Crystal Beads, Spiritual Bracelets, Gemstones and Rudraksha.',
      'We believe that spirituality is personal. That is why we go beyond simply selling individual beads or stones. Our focus is to understand the person, purpose and intention behind a customer’s purchase and create a more personalized spiritual experience around it.',
    ],
    body: '',
    moreTitle: 'More Than Just a Bracelet',
    moreBody:
      'At Kuberstones, selected spiritual bracelets can be customized according to the customer’s individual needs, preferences and intentions. Instead of offering a one-size-fits-all bracelet, we begin by understanding relevant details such as:',
    morePoints: [
      'Purpose or intention behind the purchase',
      'Personal goals or concerns',
      'Date of Birth',
      'Zodiac Sign',
      'Moon Sign',
      'Other relevant preferences voluntarily shared by the customer',
    ],
    moreClose:
      'Based on the information provided, our team identifies suitable crystal beads, gemstone beads and Rudraksha that may be relevant to the customer’s stated purpose and creates a customized spiritual bracelet accordingly.',
    collectionsTitle: 'Our Collections',
    collections: [
      { name: 'Crystal Beads', to: '/crystals', body: 'Curated crystals and natural beads selected for their natural beauty, traditional significance and suitability for spiritual and personal practices.' },
      { name: 'Spiritual Bracelets', to: '/customize', body: 'Personalized bracelet collections where different beads can be thoughtfully combined based on the customer’s purpose, intention and provided details.' },
      { name: 'Gemstones', to: '/gemstones', body: 'Natural gemstones selected for customers interested in their traditional, spiritual, astrological and aesthetic significance.' },
      { name: 'Rudraksha', to: '/rudraksha', body: 'Traditional Rudraksha products for customers who value their spiritual and devotional significance.' },
    ],
    differentTitle: 'What Makes Kuberstones Different?',
    different: [
      { title: 'Personalized, Not One-Size-Fits-All', body: 'Recommendations can be tailored using information voluntarily provided by the customer.' },
      { title: 'Shop by Purpose & Intention', body: 'Customers can explore products around their purpose, not only by product type.' },
      { title: 'Dynamic Bracelet Creation', body: 'Customized bracelets may combine crystal beads, gemstones and Rudraksha according to the stated purpose and our recommendation approach.' },
      { title: 'Tradition Meets Modern D2C', body: 'Traditional spiritual products with a convenient, professional online experience.' },
      { title: 'Transparency Over Unrealistic Promises', body: 'We do not promise guaranteed financial, medical, relationship, career or other life outcomes.' },
    ],
    approachTitle: 'Our Approach',
    approachKicker: 'Understand → Recommend → Customize → Create',
    approachBody:
      'We first understand what the customer is looking for, then use voluntarily provided information to recommend suitable beads or stones according to our stated approach. Where customization is available, these selections are brought together to create a personalized bracelet.',
    approachNote:
      'Natural crystals, gemstones and Rudraksha may vary in colour, pattern, texture, shape, inclusions and markings. These natural characteristics are part of what makes each piece unique.',
    steps: [
      { n: '01', title: 'Understand', body: 'We begin with the person, purpose and intention behind the purchase.' },
      { n: '02', title: 'Recommend', body: 'Voluntarily shared details guide suitable beads and stones.' },
      { n: '03', title: 'Customize', body: 'Where available, the strand is composed around those selections.' },
      { n: '04', title: 'Create', body: 'The bracelet is made with care, then packed and sent from the house.' },
    ],
    visionTitle: 'Our Vision',
    vision:
      'To build Kuberstones into a trusted destination for personalized spiritual products, combining Crystal Beads, Gemstones, Rudraksha and customized spiritual bracelets with a transparent, convenient and thoughtfully designed D2C experience.',
    promiseTitle: 'Our Promise',
    promises: [
      'Thoughtfully selected products',
      'Personalized recommendations where applicable',
      'Clear and responsible product information',
      'Carefully designed customized bracelets',
      'Quality-conscious packaging and handling',
      'Reliable customer support',
      'Professional and convenient shopping experience',
    ],
    closeLine: 'Kuberstones. Crystals. Gemstones. Rudraksha. Personalized With Purpose.',
    closeEntity: 'A brand by Nexxgenn Technology',
  },
  pages: PAGES_DEFAULTS,
  footer: FOOTER_DEFAULTS,
  contact: CONTACT_DEFAULTS,
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function mergeValue(fallback, stored) {
  if (stored == null || stored === '') return fallback;
  if (Array.isArray(fallback)) {
    return Array.isArray(stored) ? stored : fallback;
  }
  if (isPlainObject(fallback)) {
    const out = { ...fallback };
    Object.keys({ ...fallback, ...stored }).forEach((key) => {
      out[key] = mergeValue(fallback[key], stored[key]);
    });
    return out;
  }
  return stored;
}

function withClaimIcons(claims) {
  return (claims || []).map((claim) => ({
    ...claim,
    icon: claim.icon || ICON_FROM_TITLE[claim.title] || 'lock',
  }));
}

function mergeHomeContent(stored) {
  const merged = mergeValue(HOME_DEFAULTS, stored && typeof stored === 'object' ? stored : {});
  merged.trustClaims = withClaimIcons(merged.trustClaims);
  merged.homeLayout = mergeHomeLayout(stored?.homeLayout);
  if (stored?._id) merged._id = stored._id;
  if (stored?.key) merged.key = stored.key;
  if (stored?.createdAt) merged.createdAt = stored.createdAt;
  if (stored?.updatedAt) merged.updatedAt = stored.updatedAt;
  return merged;
}

module.exports = {
  HOME_DEFAULTS,
  ICON_FROM_TITLE,
  mergeHomeContent,
};
