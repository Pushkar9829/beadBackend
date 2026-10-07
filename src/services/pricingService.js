const DEFAULT_PACKAGING = {
  box: 44,
  clasp: 10,
  charm: 60,
  cz: 6,
  roundCz: 8,
  thread: 20,
};

function defaultPackaging() {
  return { ...DEFAULT_PACKAGING };
}

function mergePackaging(packaging) {
  return { ...DEFAULT_PACKAGING, ...(packaging || {}) };
}

function packagingBreakdown({ packaging, packagingLabels, czOptions, czStyle = 'cz' } = {}) {
  const p = mergePackaging(packaging);
  const labels = {
    box: 'Box',
    clasp: 'Clasp',
    charm: 'Charm',
    cz: 'CZ',
    roundCz: 'Round CZ',
    thread: 'Thread',
    ...(packagingLabels || {}),
  };
  // Only configured CZ styles are priceable; anything else (e.g. czStyle:"clasp") falls back to the first option.
  const options = Array.isArray(czOptions) ? czOptions : [];
  const option = options.find((row) => row.key === czStyle) || (options.length ? options[0] : null);
  const style = option?.key || (czStyle === 'round' ? 'round' : 'cz');
  const czKey = style === 'round' ? 'roundCz' : 'cz';
  const cz = option?.price != null ? Number(option.price) : Number(p[czKey] || p.cz || 0);
  const czLabel = option?.label || labels[czKey] || labels.cz || 'CZ';
  const box = Number(p.box || 0);
  const clasp = Number(p.clasp || 0);
  const charm = Number(p.charm || 0);
  const thread = Number(p.thread || 0);
  const lines = [
    { key: 'box', label: labels.box, amount: box },
    { key: 'clasp', label: labels.clasp, amount: clasp },
    { key: 'charm', label: labels.charm, amount: charm },
    { key: czKey, label: czLabel, amount: cz },
    { key: 'thread', label: labels.thread, amount: thread },
  ];
  const total = lines.reduce((sum, line) => sum + line.amount, 0);
  return { lines, total, box, clasp, charm, cz, czStyle, thread };
}

function parseWristInches(size) {
  const n = parseFloat(String(size || '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : 6.5;
}

function strandBeadCount(wristSize, beadSizeMm, { min = 8, max = 32 } = {}) {
  const inches = parseWristInches(wristSize);
  const mm = Number(beadSizeMm) || 8;
  const count = Math.round((inches * 25.4) / mm);
  return Math.max(min, Math.min(max, count));
}

function calculateCustomTotal({
  beads = [],
  packaging,
  packagingLabels,
  czOptions,
  czStyle = 'cz',
  addOns = 0,
  beadLimit = 32,
  minBeads = 1,
  baseMakingPrice = 0,
  charmPrice = 0,
  finish = null,
} = {}) {
  const lines = beads.map((b) => {
    const qty = Math.max(0, Math.floor(Number(b.quantity) || 0));
    const price = Math.max(0, Number(b.pricePerBead) || 0);
    return {
      beadId: b.beadId,
      name: b.name,
      quantity: qty,
      pricePerBead: price,
      subtotal: qty * price,
    };
  });

  const beadCount = lines.reduce((sum, l) => sum + l.quantity, 0);
  const beadsTotal = lines.reduce((sum, l) => sum + l.subtotal, 0);
  const pack = packagingBreakdown({ packaging, packagingLabels, czOptions, czStyle });
  const packagingTotal = pack.total;
  const extras = Math.max(0, Number(addOns) || 0);
  const finishPrice = Math.max(0, Number(finish?.price) || 0);
  const legacyMaking = Math.max(0, Number(baseMakingPrice) || 0);
  const legacyCharm = packaging ? 0 : Math.max(0, Number(charmPrice) || 0);
  const total = Math.max(0, beadsTotal + (packaging ? packagingTotal : legacyMaking + legacyCharm) + finishPrice + extras);
  const extraLines = finishPrice > 0
    ? [{ key: 'finish', label: `${finish.label || finish.key || 'Charm'} finish`, amount: finishPrice }]
    : [];

  const errors = [];
  if (beadCount < minBeads) errors.push(`Choose at least ${minBeads} bead${minBeads === 1 ? '' : 's'}.`);
  if (beadCount > beadLimit) errors.push(`This bracelet can hold up to ${beadLimit} beads.`);

  return {
    lines,
    beadCount,
    beadsTotal,
    packaging: pack,
    packagingTotal: packaging ? packagingTotal : 0,
    baseMakingPrice: packaging ? 0 : legacyMaking,
    charmPrice: packaging ? pack.charm : legacyCharm,
    finishPrice,
    extraLines,
    addOns: extras,
    total,
    valid: errors.length === 0,
    errors,
  };
}

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function cleanText(value, max = 120) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

async function loadStudioConfig() {
  const BraceletConfig = require('../models/BraceletConfig');
  const { withStudioDefaults } = require('../data/studioConfigDefaults');
  return withStudioDefaults(await BraceletConfig.findOne().lean());
}

/**
 * Prices a custom bracelet purely from server data (current Bead prices, Charm finish, studio config).
 * Client prices / add-ons are never trusted. Throws 400 on invalid input.
 */
async function priceCustomBracelet({ beads: rawBeads, charmId, finishKey, czStyle } = {}, config) {
  const mongoose = require('mongoose');
  const Bead = require('../models/Bead');
  const Charm = require('../models/Charm');
  const cfg = config || (await loadStudioConfig());
  const beadLimit = Math.max(1, Math.floor(Number(cfg.beadLimit) || 32));

  if (!Array.isArray(rawBeads)) throw badRequest('Choose the beads for your bracelet.');
  const requested = [];
  for (const b of rawBeads) {
    const qty = Number(b?.quantity);
    if (qty === 0) continue;
    if (!Number.isInteger(qty) || qty < 1 || qty > beadLimit) throw badRequest('Bead quantities must be whole numbers.');
    if (!mongoose.isObjectIdOrHexString(b?.beadId)) throw badRequest('One of the selected beads is not available.');
    requested.push({ beadId: String(b.beadId), quantity: qty });
  }

  const charm = charmId && mongoose.isObjectIdOrHexString(charmId)
    ? await Charm.findOne({ _id: charmId, isActive: { $ne: false } }).lean()
    : null;
  if (charmId && !charm) throw badRequest('The selected charm is no longer available.');
  if (cfg.charmRequired !== false && !charm) throw badRequest('Please choose a charm.');
  const finish = charm?.finishes?.find((f) => f.key === finishKey) || charm?.finishes?.[0] || null;

  const beadDocs = requested.length
    ? await Bead.find({ _id: { $in: requested.map((b) => b.beadId) }, isActive: { $ne: false } }).lean()
    : [];
  const byId = Object.fromEntries(beadDocs.map((b) => [String(b._id), b]));
  const beads = requested.map((b) => {
    const doc = byId[b.beadId];
    if (!doc) throw badRequest('One of the selected beads is no longer available.');
    return {
      beadId: doc._id,
      name: doc.name,
      slug: doc.slug,
      image: doc.image,
      colorHex: doc.colorHex,
      quantity: b.quantity,
      pricePerBead: doc.pricePerBead,
      powerUse: doc.powerUse,
    };
  });

  const style = cleanText(czStyle, 40) || cfg.defaultCzStyle || 'cz';
  const quote = calculateCustomTotal({
    beads,
    packaging: cfg.packaging,
    packagingLabels: cfg.packagingLabels,
    czOptions: cfg.czOptions,
    czStyle: style,
    addOns: 0,
    finish,
    beadLimit,
    minBeads: cfg.minBeads,
  });
  if (!quote.valid) throw badRequest(quote.errors.join(' '));
  return { config: cfg, charm, finish, beads, czStyle: style, quote };
}

// Builds the cart snapshot for a custom bracelet from a client payload, pricing server-side only.
async function buildCustomSnapshot(payload = {}) {
  const snap = payload.snapshot && typeof payload.snapshot === 'object' ? payload.snapshot : {};
  const { config, charm, finish, beads, czStyle, quote } = await priceCustomBracelet({
    beads: payload.beads !== undefined
      ? payload.beads
      : (Array.isArray(snap.beads) ? snap.beads.map((b) => ({ beadId: b?.beadId, quantity: b?.quantity })) : undefined),
    charmId: payload.charmId || snap.charm?.id,
    finishKey: payload.finishKey || snap.finish?.key,
    czStyle: payload.czStyle || snap.czStyle,
  });
  const intention = payload.intention && typeof payload.intention === 'object' ? payload.intention : undefined;
  const braceletName = cleanText(intention?.braceletName) || cleanText(intention?.name) || 'Custom bracelet';
  const pieceName = cleanText(snap.name) || (charm?.name ? `${braceletName} · ${charm.name}` : braceletName);

  return {
    kind: 'custom_bracelet',
    name: pieceName,
    purpose: payload.purpose,
    intention,
    layer: payload.layer || snap.layer,
    layerSelections: snap.layerSelections,
    dateOfBirth: cleanText(payload.dateOfBirth, 20) || cleanText(snap.dateOfBirth, 20),
    mulank: snap.mulank,
    bhagyank: snap.bhagyank,
    zodiac: snap.zodiac,
    explanation: snap.explanation,
    beads: quote.lines.map((line, i) => ({ ...beads[i], ...line })),
    charm: charm ? { id: charm._id, name: charm.name, slug: charm.slug } : null,
    finish,
    threadType: cleanText(payload.threadType, 60) || cleanText(snap.threadType, 60) || undefined,
    wristSize: cleanText(payload.wristSize, 20) || cleanText(snap.wristSize, 20) || config.defaultWristSize,
    beadSizeMm: Number(payload.beadSizeMm || snap.beadSizeMm) || undefined,
    czStyle,
    engravingName: cleanText(payload.engravingName, 40) || cleanText(snap.engravingName, 40),
    pricing: quote,
  };
}

// Re-prices a stored custom bracelet snapshot against current catalogue prices.
async function repriceCustomSnapshot(snapshot = {}, config) {
  return priceCustomBracelet({
    beads: (snapshot.beads || []).map((b) => ({ beadId: b.beadId, quantity: b.quantity })),
    charmId: snapshot.charm?.id,
    finishKey: snapshot.finish?.key,
    czStyle: snapshot.czStyle,
  }, config);
}

module.exports = {
  loadStudioConfig,
  priceCustomBracelet,
  buildCustomSnapshot,
  repriceCustomSnapshot,
  DEFAULT_PACKAGING,
  defaultPackaging,
  mergePackaging,
  packagingBreakdown,
  parseWristInches,
  strandBeadCount,
  calculateCustomTotal,
};
