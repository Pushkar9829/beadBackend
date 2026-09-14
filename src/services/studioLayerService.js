const Bead = require('../models/Bead');
const { catalogFor, MODES } = require('../data/studioLayers');
const { bhagyankFromDate, mulankFromDate } = require('./numerologyService');

const ALIASES = {
  obsidian: ['obsidian', 'black obsidian', 'obsidian / black obsidian'],
  'black obsidian': ['obsidian'],
  'obsidian / black obsidian': ['obsidian', 'black obsidian'],
  'tiger eye': ['tiger eye', "tiger's eye", 'tigers eye'],
};

function keyName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function matchBead(beads, name) {
  const wanted = new Set([keyName(name), ...(ALIASES[keyName(name)] || []).map(keyName)]);
  return (
    beads.find((bead) => {
      const names = [keyName(bead.name), keyName(bead.slug)];
      return names.some((n) => wanted.has(n));
    }) || null
  );
}

function publicBead(bead) {
  if (!bead) return null;
  return {
    _id: bead._id,
    name: bead.name,
    slug: bead.slug,
    image: bead.image,
    colorHex: bead.colorHex,
    pricePerBead: bead.pricePerBead,
    shortDescriptor: bead.shortDescriptor,
    powerUse: bead.powerUse,
  };
}

function attachNames(names, beads) {
  return (names || []).map((name) => {
    const bead = matchBead(beads, name);
    return {
      name,
      available: Boolean(bead),
      bead: publicBead(bead),
    };
  });
}

async function loadBeads() {
  return Bead.find({ isActive: true }).lean();
}

function decorateItem(kind, item, beads) {
  if (!item) return null;
  if (kind === 'numerology') {
    return {
      slug: item.slug,
      number: item.number,
      name: `Number ${item.number}`,
      theme: item.theme,
      mulank: attachNames(item.mulank, beads),
      bhagyank: attachNames(item.bhagyank, beads),
      recommended: attachNames([...new Set([...(item.mulank || []), ...(item.bhagyank || [])])], beads),
      rule: 'Customer may select any 3 or all 4 from each layer. Identical crystals are kept once in the final strand.',
    };
  }
  return {
    slug: item.slug,
    name: item.name,
    hindi: item.hindi,
    dates: item.dates,
    theme: item.theme,
    suitable: attachNames(item.suitable || item.recommended, beads),
    recommended: attachNames(item.recommended, beads),
  };
}

async function listLayers(kind) {
  const mode = MODES[kind];
  if (!mode || kind === 'purpose') return null;
  const beads = await loadBeads();
  const items = catalogFor(kind).map((item) => decorateItem(kind, item, beads));
  return { kind, label: mode.label, path: mode.path, items };
}

async function getLayerItem(kind, slug) {
  const list = catalogFor(kind);
  const item = list.find((row) => String(row.slug) === String(slug));
  if (!item) return null;
  const beads = await loadBeads();
  return decorateItem(kind, item, beads);
}

function numerologyFromDate(iso) {
  return {
    mulank: mulankFromDate(iso),
    bhagyank: bhagyankFromDate(iso),
  };
}

module.exports = {
  listLayers,
  getLayerItem,
  numerologyFromDate,
  matchBead,
};
