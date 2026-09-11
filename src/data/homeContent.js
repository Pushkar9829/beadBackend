const { PAGES_DEFAULTS, FOOTER_DEFAULTS, CONTACT_DEFAULTS } = require('./sitePages');

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
    { icon: 'shield', title: 'Secure Payments', body: 'Encrypted checkout will be enabled in the next release. Orders today are held as pending payment.' },
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
    headline: 'Jewellery as a quiet ritual',
    tagline: 'Editorial luxury for modern seekers.',
    body: 'Kuberstones is a contemporary jewellery house working with crystals, rudraksha and gemstones. Customize Your Bracelet is the heart of the brand: you choose a purpose and intention, we place the crystals from your Mulank calibration, add zodiac beads, then engrave the name you give the piece.\n\nEvery recommendation is tied to a traditional association, written in plain language. We do not make medical claims.',
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
    return Array.isArray(stored) && stored.length ? stored : fallback;
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
