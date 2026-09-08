const Cart = require('../models/Cart');
const Product = require('../models/Product');
const Bead = require('../models/Bead');
const Charm = require('../models/Charm');
const BraceletConfig = require('../models/BraceletConfig');
const { calculateCustomTotal } = require('../services/pricingService');
const { calibrate } = require('../services/calibrationService');
const { asyncHandler } = require('../utils/asyncHandler');

async function getOrCreateCart(userId) {
  let cart = await Cart.findOne({ userId });
  if (!cart) cart = await Cart.create({ userId, items: [] });
  return cart;
}

function normalizeEngraving(name) {
  const n = String(name || '').trim().replace(/\s+/g, ' ');
  if (n.length < 2 || n.length > 32) {
    const err = new Error('Enter a name between 2 and 32 characters for the charm.');
    err.status = 400;
    throw err;
  }
  return n;
}

async function buildCustomSnapshot(payload) {
  const config = await BraceletConfig.findOne().lean();
  const charm = await Charm.findById(payload.charmId).lean();
  if (!charm) {
    const err = new Error('Please choose a charm.');
    err.status = 400;
    throw err;
  }
  const finish = charm.finishes.find((f) => f.key === payload.finishKey) || charm.finishes[0];
  const engravingName = normalizeEngraving(payload.engravingName || payload.snapshot?.engravingName);

  if (payload.dateOfBirth && (payload.intentionId || payload.intention?.id)) {
    const calibrated = await calibrate({
      intentionId: payload.intentionId || payload.intention.id,
      dateOfBirth: payload.dateOfBirth,
      includeZodiac: payload.includeZodiac !== false,
      zodiacQty: payload.zodiacQty,
      charmId: charm._id,
      finishKey: finish.key,
    });
    if (!calibrated.quote.valid) {
      const err = new Error(calibrated.quote.errors.join(' '));
      err.status = 400;
      throw err;
    }
    return {
      kind: 'custom_bracelet',
      name: `${engravingName} · ${payload.intention?.name || 'Custom bracelet'}`,
      purpose: payload.purpose,
      intention: payload.intention,
      dateOfBirth: calibrated.dateOfBirth,
      mulank: calibrated.mulank,
      bhagyank: calibrated.bhagyank,
      mulankCrystal: calibrated.mulankCrystal,
      zodiac: calibrated.zodiac,
      layout: calibrated.layout,
      beads: calibrated.beads,
      engravingName,
      explanation: calibrated.explanation,
      charm: { id: charm._id, name: charm.name },
      finish,
      wristSize: payload.wristSize || config.defaultWristSize,
      pricing: calibrated.quote,
    };
  }

  const beadIds = (payload.beads || []).map((b) => b.beadId);
  const beadDocs = await Bead.find({ _id: { $in: beadIds } }).lean();
  const byId = Object.fromEntries(beadDocs.map((b) => [String(b._id), b]));

  const beads = (payload.beads || [])
    .filter((b) => Number(b.quantity) > 0)
    .map((b) => {
      const doc = byId[String(b.beadId)];
      if (!doc) return null;
      return {
        beadId: doc._id,
        name: doc.name,
        slug: doc.slug,
        image: doc.image,
        colorHex: doc.colorHex,
        quantity: Number(b.quantity),
        pricePerBead: doc.pricePerBead,
        powerUse: doc.powerUse,
      };
    })
    .filter(Boolean);

  const quote = calculateCustomTotal({
    baseMakingPrice: config.baseMakingPrice,
    beads,
    charmPrice: finish.price,
    addOns: payload.addOns || 0,
    beadLimit: config.beadLimit,
    minBeads: config.minBeads,
  });

  if (!quote.valid) {
    const err = new Error(quote.errors.join(' '));
    err.status = 400;
    throw err;
  }

  return {
    kind: 'custom_bracelet',
    purpose: payload.purpose,
    intention: payload.intention,
    beads: quote.lines.map((line, i) => ({ ...beads[i], ...line })),
    charm: { id: charm._id, name: charm.name },
    finish,
    wristSize: payload.wristSize || config.defaultWristSize,
    engravingName,
    pricing: quote,
  };
}

exports.getCart = asyncHandler(async (req, res) => {
  const cart = await getOrCreateCart(req.user._id);
  res.json({ cart });
});

exports.addItem = asyncHandler(async (req, res) => {
  const cart = await getOrCreateCart(req.user._id);
  const { kind } = req.body;

  if (kind === 'product') {
    const product = await Product.findById(req.body.productId);
    if (!product || !product.isActive) return res.status(404).json({ message: 'Product not found.' });
    const quantity = Number(req.body.quantity || 1);
    const existing = cart.items.find((i) => i.kind === 'product' && String(i.productId) === String(product._id));
    if (existing) {
      existing.quantity += quantity;
      existing.lineTotal = existing.quantity * existing.unitPrice;
    } else {
      cart.items.push({
        kind: 'product',
        productId: product._id,
        quantity,
        unitPrice: product.price,
        lineTotal: product.price * quantity,
        snapshot: {
          name: product.name,
          slug: product.slug,
          image: product.images?.[0],
          colorHex: product.colorHex,
          family: product.family,
        },
      });
    }
  } else if (kind === 'custom_bracelet') {
    const snapshot = await buildCustomSnapshot(req.body);
    cart.items.push({
      kind: 'custom_bracelet',
      quantity: 1,
      unitPrice: snapshot.pricing.total,
      lineTotal: snapshot.pricing.total,
      snapshot,
    });
  } else {
    return res.status(400).json({ message: 'Unknown cart item type.' });
  }

  await cart.save();
  res.json({ cart });
});

exports.updateItem = asyncHandler(async (req, res) => {
  const cart = await getOrCreateCart(req.user._id);
  const item = cart.items.id(req.params.itemId);
  if (!item) return res.status(404).json({ message: 'Item not found.' });
  if (req.body.quantity !== undefined) {
    item.quantity = Math.max(1, Number(req.body.quantity));
    item.lineTotal = item.quantity * item.unitPrice;
  }
  await cart.save();
  res.json({ cart });
});

exports.removeItem = asyncHandler(async (req, res) => {
  const cart = await getOrCreateCart(req.user._id);
  cart.items = cart.items.filter((i) => String(i._id) !== req.params.itemId);
  await cart.save();
  res.json({ cart });
});

exports.clearCart = asyncHandler(async (req, res) => {
  const cart = await getOrCreateCart(req.user._id);
  cart.items = [];
  await cart.save();
  res.json({ cart });
});

exports.mergeCart = asyncHandler(async (req, res) => {
  const cart = await getOrCreateCart(req.user._id);
  const incoming = Array.isArray(req.body.items) ? req.body.items : [];

  for (const raw of incoming) {
    if (raw.kind === 'product' && raw.productId) {
      const product = await Product.findById(raw.productId);
      if (!product || !product.isActive) continue;
      const quantity = Number(raw.quantity || 1);
      const existing = cart.items.find((i) => i.kind === 'product' && String(i.productId) === String(product._id));
      if (existing) {
        existing.quantity += quantity;
        existing.lineTotal = existing.quantity * existing.unitPrice;
      } else {
        cart.items.push({
          kind: 'product',
          productId: product._id,
          quantity,
          unitPrice: product.price,
          lineTotal: product.price * quantity,
          snapshot: {
            name: product.name,
            slug: product.slug,
            image: product.images?.[0],
            colorHex: product.colorHex,
            family: product.family,
          },
        });
      }
    } else if (raw.kind === 'custom_bracelet') {
      try {
        const snapshot = raw.snapshot?.pricing
          ? raw.snapshot
          : await buildCustomSnapshot(raw);
        cart.items.push({
          kind: 'custom_bracelet',
          quantity: 1,
          unitPrice: snapshot.pricing?.total || raw.unitPrice,
          lineTotal: snapshot.pricing?.total || raw.lineTotal,
          snapshot,
        });
      } catch {
        /* skip invalid custom items */
      }
    }
  }

  await cart.save();
  res.json({ cart });
});

exports.buildCustomSnapshot = buildCustomSnapshot;
