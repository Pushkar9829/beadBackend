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
  const option = (czOptions || []).find((row) => row.key === czStyle);
  const czKey = option?.key === 'round' || czStyle === 'round' ? 'roundCz' : (option?.key === 'cz' ? 'cz' : czStyle || 'cz');
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
} = {}) {
  const lines = beads.map((b) => {
    const qty = Number(b.quantity || 0);
    const price = Number(b.pricePerBead || 0);
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
  const extras = Number(addOns || 0);
  const legacyMaking = Number(baseMakingPrice || 0);
  const legacyCharm = packaging ? 0 : Number(charmPrice || 0);
  const total = beadsTotal + (packaging ? packagingTotal : legacyMaking + legacyCharm) + extras;

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
    addOns: extras,
    total,
    valid: errors.length === 0,
    errors,
  };
}

module.exports = {
  DEFAULT_PACKAGING,
  defaultPackaging,
  mergePackaging,
  packagingBreakdown,
  parseWristInches,
  strandBeadCount,
  calculateCustomTotal,
};
