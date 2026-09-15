const Bead = require('../models/Bead');
const StudioLayer = require('../models/StudioLayer');
const { catalogFor, MODES } = require('../data/studioLayers');
const { bhagyankFromDate, mulankFromDate } = require('./numerologyService');
const { ensureStudioLayers } = require('../seed/ensureStudioLayers');

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

function attachNames(names, beads, flags = {}) {
  const shared = flags.shared || new Set();
  const core = flags.core || null;
  return (names || []).map((name) => {
    const bead = matchBead(beads, name);
    return {
      name,
      available: Boolean(bead),
      bead: publicBead(bead),
      shared: shared.has(name),
      core: core ? core.has(name) : undefined,
    };
  });
}

async function loadBeads() {
  return Bead.find({ isActive: true }).lean();
}

function publicLayerName(item) {
  const name = String(item?.name || '').trim();
  if (!name || /^number\s*\d+$/i.test(name)) return item?.theme || '';
  return name;
}

function decorateItem(kind, item, beads) {
  if (!item) return null;
  if (kind === 'numerology') {
    const shared = new Set((item.mulank || []).filter((name) => (item.bhagyank || []).includes(name)));
    return {
      slug: item.slug,
      number: Number(item.number ?? item.slug),
      name: publicLayerName(item),
      theme: item.theme,
      shared: [...shared],
      mulank: attachNames(item.mulank, beads, { shared }),
      bhagyank: attachNames(item.bhagyank, beads, { shared }),
      recommended: attachNames([...new Set([...(item.mulank || []), ...(item.bhagyank || [])])], beads, { shared }),
      rule: 'Customer may select any 3 or all 4 from each layer. Identical crystals are kept once in the final strand, with both roles stored.',
    };
  }
  const core = new Set(item.recommended || []);
  return {
    slug: item.slug,
    name: item.name,
    hindi: item.hindi,
    dates: item.dates,
    theme: item.theme,
    suitable: attachNames(item.suitable || item.recommended, beads, { core }),
    recommended: attachNames(item.recommended, beads, { core }),
    rule: kind === 'zodiac'
      ? 'Keep any 3 or all 4 recommended crystals. Suitable catalog stones may be added. Traditional symbolism, not medical claims.'
      : 'Keep any 3 or all 4 recommended crystals, then continue to charm and review.',
  };
}

async function loadCatalog(kind) {
  await ensureStudioLayers();
  const rows = await StudioLayer.find({ kind }).sort({ sortOrder: 1, number: 1, name: 1 }).lean();
  if (!rows.length) return catalogFor(kind);
  return rows.filter((row) => row.isActive !== false);
}

async function listLayers(kind) {
  const mode = MODES[kind];
  if (!mode || kind === 'purpose') return null;
  const beads = await loadBeads();
  const items = (await loadCatalog(kind)).map((item) => decorateItem(kind, item, beads));
  return { kind, label: mode.label, path: mode.path, items };
}

async function getLayerItem(kind, slug) {
  await ensureStudioLayers();
  const raw = String(slug || '').trim();
  const asNumber = Number(raw);
  const fromDb = await StudioLayer.findOne({
    kind,
    $or: [
      { slug: raw.toLowerCase() },
      ...(kind === 'numerology' && Number.isFinite(asNumber) ? [{ number: asNumber }] : []),
    ],
  }).lean();
  if (fromDb) {
    if (fromDb.isActive === false) return null;
    const beads = await loadBeads();
    return decorateItem(kind, fromDb, beads);
  }
  const count = await StudioLayer.countDocuments({ kind });
  if (count) return null;
  const item = catalogFor(kind).find((row) => String(row.slug) === String(slug));
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
