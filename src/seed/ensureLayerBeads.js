require('dotenv').config();
const { connectDb } = require('../config/db');
const Bead = require('../models/Bead');
const { slugifyName } = require('../utils/asyncHandler');
const { sellingPriceFor } = require('../data/beadPriceSource');

const DISCLAIMER =
  'These are traditional and spiritual associations, not medical claims. Kuberstones products are not intended to diagnose, treat, or cure any condition.';

const EXTRA_LAYER_BEADS = [
  {
    name: 'Sunstone',
    shortDescriptor: 'Leadership light',
    powerUse: 'Warms confidence, initiative and a generous presence.',
    benefits: ['Lifts mood', 'Supports leadership', 'Invites optimism', 'Energises the day'],
    chakra: 'Solar Plexus / Sacral',
    careNotes: 'Avoid harsh chemicals. Soft cloth only.',
    pricePerBead: sellingPriceFor('Sunstone') ?? 250,
    colorHex: '#E39B4A',
    image: '/catalog/beads/bead-citrine.jpg',
  },
  {
    name: 'Red Jasper',
    shortDescriptor: 'Steady courage',
    powerUse: 'Grounds action and endurance in the body.',
    benefits: ['Builds stamina', 'Steadies nerves', 'Supports courage', 'Roots scattered energy'],
    chakra: 'Root',
    careNotes: 'Wipe with a damp cloth. Dry thoroughly.',
    pricePerBead: 42,
    colorHex: '#B44A3A',
    image: '/catalog/beads/bead-garnet.jpg',
  },
  {
    name: 'Fluorite',
    shortDescriptor: 'Order in thought',
    powerUse: 'Clears mental clutter so study and decisions feel clean.',
    benefits: ['Supports focus', 'Calms overthinking', 'Aids learning', 'Sorts priorities'],
    chakra: 'Third Eye',
    careNotes: 'Keep away from prolonged sunlight.',
    pricePerBead: sellingPriceFor('Fluorite') ?? 45,
    colorHex: '#7B8FD4',
    image: '/catalog/beads/bead-sodalite.jpg',
  },
  {
    name: 'Lepidolite',
    shortDescriptor: 'Gentle nervous-system stone',
    powerUse: 'Softens intensity and invites emotional evenness.',
    benefits: ['Soothes anxiety', 'Supports rest', 'Balances mood', 'Eases transition'],
    chakra: 'Heart / Crown',
    careNotes: 'Handle gently. Avoid water soaks.',
    pricePerBead: sellingPriceFor('Lepidolite') ?? 125,
    colorHex: '#A88BB8',
    image: '/catalog/beads/bead-amethyst.jpg',
  },
  {
    name: 'Obsidian',
    shortDescriptor: 'Clear shield',
    powerUse: 'Cuts psychic noise and holds a firm personal boundary.',
    benefits: ['Protects the field', 'Grounds quickly', 'Releases heaviness', 'Clarifies truth'],
    chakra: 'Root',
    careNotes: 'Wipe clean. Keep separate from softer stones in storage.',
    pricePerBead: sellingPriceFor('Obsidian') ?? 55,
    colorHex: '#1A1A1A',
    image: '/catalog/beads/bead-black-tourmaline.jpg',
  },
  {
    name: 'Hematite',
    shortDescriptor: 'Iron calm',
    powerUse: 'Pulls awareness into the body and steadies will.',
    benefits: ['Grounds energy', 'Supports focus', 'Strengthens resolve', 'Balances drive'],
    chakra: 'Root',
    careNotes: 'Keep dry. Wipe with a soft cloth.',
    pricePerBead: sellingPriceFor('Hematite') ?? 11.25,
    colorHex: '#6B6F76',
    image: '/catalog/beads/bead-black-tourmaline.jpg',
  },
  {
    name: 'Smoky Quartz',
    shortDescriptor: 'Quiet gravity',
    powerUse: 'Transmutes heaviness and keeps the field practical.',
    benefits: ['Grounds stress', 'Clears residue', 'Supports discipline', 'Softens overwhelm'],
    chakra: 'Root',
    careNotes: 'Rinse in lukewarm water. Dry thoroughly.',
    pricePerBead: sellingPriceFor('Smoky Quartz') ?? 160,
    colorHex: '#6B5344',
    image: '/catalog/beads/bead-black-tourmaline.jpg',
  },
  {
    name: 'Shungite',
    shortDescriptor: 'Deep filter',
    powerUse: 'Traditional stone of purification and electromagnetic quiet.',
    benefits: ['Grounds the field', 'Supports cleansing rituals', 'Steadies mood', 'Holds a boundary'],
    chakra: 'Root',
    careNotes: 'Wipe dry. Do not soak for long periods.',
    pricePerBead: sellingPriceFor('Shungite') ?? 335,
    colorHex: '#111111',
    image: '/catalog/beads/bead-black-tourmaline.jpg',
  },
  {
    name: 'Blue Lace Agate',
    shortDescriptor: 'Soft speech',
    powerUse: 'Eases the throat so words come without strain.',
    benefits: ['Calms communication', 'Soothes tension', 'Supports kindness in speech', 'Cools heat'],
    chakra: 'Throat',
    careNotes: 'Avoid harsh cleaners. Soft cloth only.',
    pricePerBead: sellingPriceFor('Blue Lace Agate') ?? 1167.5,
    colorHex: '#8BB8D4',
    image: '/catalog/beads/bead-sodalite.jpg',
  },
  {
    name: 'Howlite',
    shortDescriptor: 'Quiet mind',
    powerUse: 'Softens restlessness so thought and rest can settle.',
    benefits: ['Calms the mind', 'Supports patience', 'Eases tension', 'Aids rest'],
    chakra: 'Crown',
    careNotes: 'Avoid harsh cleaners. Soft cloth only.',
    pricePerBead: sellingPriceFor('Howlite') ?? 50,
    colorHex: '#E8E4DC',
    image: '/catalog/beads/bead-clear-quartz.jpg',
  },
];

async function ensureLayerBeads() {
  const created = [];
  const priced = [];
  for (const bead of EXTRA_LAYER_BEADS) {
    const slug = slugifyName(bead.name);
    const existing = await Bead.findOne({ $or: [{ slug }, { name: bead.name }] });
    if (existing) continue;
    await Bead.create({
      ...bead,
      slug,
      disclaimer: DISCLAIMER,
      stock: 500,
      isActive: true,
      textureUrl: bead.image,
    });
    created.push(bead.name);
  }

  const all = await Bead.find();
  for (const bead of all) {
    const price = sellingPriceFor(bead.name);
    if (price == null || price <= 0) continue;
    if (Number(bead.pricePerBead) === Number(price)) continue;
    bead.pricePerBead = price;
    await bead.save();
    priced.push(bead.name);
  }
  return { created, priced };
}

module.exports = { ensureLayerBeads, EXTRA_LAYER_BEADS };

if (require.main === module) {
  connectDb()
    .then(() => ensureLayerBeads())
    .then((result) => {
      console.log(
        [
          result.created.length ? `Added layer beads: ${result.created.join(', ')}` : '',
          result.priced?.length ? `Catalog prices: ${result.priced.join(', ')}` : '',
          !result.created.length && !result.priced?.length ? 'Layer beads already present.' : '',
        ]
          .filter(Boolean)
          .join('\n')
      );
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
