function calculateCustomTotal({
  baseMakingPrice = 0,
  beads = [],
  charmPrice = 0,
  addOns = 0,
  beadLimit = 18,
  minBeads = 1,
}) {
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
  const total = Number(baseMakingPrice) + beadsTotal + Number(charmPrice || 0) + Number(addOns || 0);

  const errors = [];
  if (beadCount < minBeads) errors.push(`Choose at least ${minBeads} bead${minBeads === 1 ? '' : 's'}.`);
  if (beadCount > beadLimit) errors.push(`This bracelet can hold up to ${beadLimit} beads.`);

  return {
    lines,
    beadCount,
    beadsTotal,
    baseMakingPrice: Number(baseMakingPrice),
    charmPrice: Number(charmPrice || 0),
    addOns: Number(addOns || 0),
    total,
    valid: errors.length === 0,
    errors,
  };
}

module.exports = { calculateCustomTotal };
