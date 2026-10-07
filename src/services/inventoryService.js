const Order = require('../models/Order');
const Product = require('../models/Product');
const Bead = require('../models/Bead');
const { notify } = require('./notificationService');

function stockError(message) {
  const err = new Error(message);
  err.status = 409;
  return err;
}

// Flattens order/cart lines into per-document stock movements.
// Products are tracked strictly; beads inside custom bracelets are tracked but allowed to go short.
function stockLines(items = []) {
  const lines = [];
  for (const item of items) {
    const qty = Math.max(1, Math.floor(Number(item.quantity) || 1));
    if (item.kind === 'product' && item.productId) {
      lines.push({ model: Product, id: item.productId, qty, name: item.snapshot?.name || item.name || 'Item', strict: true });
    } else if (item.kind === 'custom_bracelet') {
      for (const bead of item.snapshot?.beads || []) {
        const perPiece = Math.floor(Number(bead.quantity) || 0);
        if (!bead.beadId || perPiece <= 0) continue;
        lines.push({ model: Bead, id: bead.beadId, qty: perPiece * qty, name: bead.name || 'Bead', strict: false });
      }
    }
  }
  return lines;
}

async function stockAlerts(doc, order) {
  if (!doc || doc.constructor?.modelName !== 'Product') return;
  const stock = doc.stock || 0;
  if (stock <= 0) {
    await notify({
      type: 'out_of_stock',
      title: `${doc.name} is out of stock`,
      body: `Stock is ${stock} after order ${order.orderNumber}.`,
      link: '/admin/inventory',
    });
  } else if (stock <= (doc.lowStockLimit ?? 5)) {
    await notify({
      type: 'low_stock',
      title: `${doc.name} is low on stock`,
      body: `Stock is ${stock} after order ${order.orderNumber}.`,
      link: '/admin/inventory/low',
    });
  }
}

async function safeNotify(payload) {
  try {
    await notify(payload);
  } catch (err) {
    console.warn('[stock] notify failed:', err.message);
  }
}

async function rollback(applied) {
  for (const line of applied) {
    await line.model.updateOne({ _id: line.id }, { $inc: { stock: line.qty } });
  }
}

/**
 * Deducts stock for an order exactly once (guarded by order.inventory.deducted).
 * strict=true  → throws 409 and leaves stock untouched if any product is short (use before taking payment).
 * strict=false → always deducts; shortfalls are flagged on the order and notified (use after payment is captured).
 */
async function deductOrderStock(order, { strict = true } = {}) {
  const claimed = await Order.findOneAndUpdate(
    { _id: order._id, 'inventory.deducted': { $ne: true } },
    { $set: { 'inventory.deducted': true, 'inventory.deductedAt': new Date(), 'inventory.restored': false } },
    { returnDocument: 'after' }
  );
  if (!claimed) return { skipped: true };

  const applied = [];
  const short = [];
  const touched = [];
  try {
    for (const line of stockLines(order.items)) {
      const guarded = strict && line.strict;
      const doc = await line.model.findOneAndUpdate(
        guarded ? { _id: line.id, stock: { $gte: line.qty } } : { _id: line.id },
        { $inc: { stock: -line.qty } },
        { returnDocument: 'after' }
      );
      if (!doc) {
        if (guarded) {
          const exists = await line.model.exists({ _id: line.id });
          if (exists) throw stockError(`${line.name} does not have enough stock.`);
        }
        continue;
      }
      applied.push(line);
      touched.push(doc);
      if (line.strict && doc.stock < 0) short.push(line.name);
    }
  } catch (err) {
    await rollback(applied);
    await Order.updateOne({ _id: order._id }, { $set: { 'inventory.deducted': false }, $unset: { 'inventory.deductedAt': 1 } });
    throw err;
  }

  if (short.length) {
    await Order.updateOne({ _id: order._id }, { $set: { 'inventory.oversold': true } });
    await safeNotify({
      type: 'out_of_stock',
      title: `Order ${order.orderNumber} was oversold`,
      body: `Paid order needs stock for: ${short.join(', ')}.`,
      link: '/admin/orders',
      meta: { orderId: order._id },
    });
  }
  for (const doc of touched) await stockAlerts(doc, order).catch((err) => console.warn('[stock] alert failed:', err.message));
  return { deducted: true, oversold: short.length > 0 };
}

// Puts stock back exactly once, and only if it was deducted.
async function restoreOrderStock(order) {
  const claimed = await Order.findOneAndUpdate(
    { _id: order._id, 'inventory.deducted': true, 'inventory.restored': { $ne: true } },
    { $set: { 'inventory.restored': true, 'inventory.restoredAt': new Date() } },
    { returnDocument: 'after' }
  );
  if (!claimed) return { skipped: true };
  for (const line of stockLines(claimed.items)) {
    await line.model.updateOne({ _id: line.id }, { $inc: { stock: line.qty } });
  }
  return { restored: true };
}

module.exports = { stockLines, deductOrderStock, restoreOrderStock };
