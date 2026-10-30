// Free Kundli (AstrologyAPI "Standard" set) for signed-in customers whose order reaches the CMS threshold
// (home content kundali.threshold, e.g. '₹2,000').
// Flow: birth details are saved from the home modal or Account → My Kundli (signed in only). An order
// unlocks the Kundli once it is confirmed: online (Cashfree) or UPI orders when their payment is paid,
// COD orders when they are delivered. Only confirmations at or after the launch cutoff count, and
// cancelled, returned or refunded orders never do. Generation then runs once in the background.
//
// Every run goes through queue() (an atomic transition into 'queued') and generate() (an atomic claim
// 'queued' -> 'generating'), so one Kundli can never be generated twice at the same time. Runs that
// died (restart, OOM) are picked up by the stale checks and the periodic sweep (startKundliJobs).
const mongoose = require('mongoose');
const Kundli = require('../models/Kundli');
const KundliSetting = require('../models/KundliSetting');
const { KundliPlaceCache, KundliPlaceQuota } = require('../models/KundliPlace');
const Order = require('../models/Order');
const User = require('../models/User');
const Product = require('../models/Product');
const Bead = require('../models/Bead');
const SiteContent = require('../models/SiteContent');
const StoreSettings = require('../models/StoreSettings');
const { mergeHomeContent } = require('../data/homeContent');
const { escapeRegex, toStr } = require('../utils/asyncHandler');
const { notify } = require('./notificationService');
const astrology = require('./astrologyApi');

const DEFAULT_THRESHOLD = 2000;
// A threshold below this is treated as a CMS typo (e.g. "Rs. 2,000" misread) and ignored.
const MIN_THRESHOLD = 500;
const CLOSED_STATUSES = ['cancelled', 'returned'];
const RUNNING = ['queued', 'generating'];
const CONCURRENCY = 3;
// A 'generating' claim older than this is assumed crashed and may be taken over.
const RUN_STALE_MS = 5 * 60 * 1000;
// A 'queued' record whose run never started (process died in between) is picked up after this.
const QUEUE_STALE_MS = 2 * 60 * 1000;
const SWEEP_MS = 2 * 60 * 1000;
// Customers may change the details of a generated Kundli (which regenerates it, spending credits) once a
// day, and at most KUNDLI_CUSTOMER_REGEN_CAP times in total. Admin regenerations are not limited.
const CUSTOMER_COOLDOWN_MS = 24 * 60 * 60 * 1000;
// Minimum gap between two customer-started runs (e.g. retrying a failed Kundli).
const CUSTOMER_RETRY_GAP_MS = 10 * 60 * 1000;
const DATE_RX = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RX = /^([01]\d|2[0-3]):([0-5]\d)$/;

function envInt(name, fallback, min = 0) {
  const n = Number.parseInt(process.env[name], 10);
  return Number.isInteger(n) && n >= min ? n : fallback;
}
const regenCap = () => envInt('KUNDLI_CUSTOMER_REGEN_CAP', 3);
const retryCap = () => envInt('KUNDLI_CUSTOMER_RETRY_CAP', 3);

function badRequest(message, status = 400, code) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  return err;
}

const warned = new Set();
function warnOnce(message) {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(`[kundli] ${message}`);
}

function istWhen(date) {
  return new Date(date).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

/* ---------------- threshold ---------------- */

/**
 * '₹2,000' / 'Rs. 2,000' / 'Rs.2000' / '2000' -> 2000; '₹2k' -> 2000; '2.5k' -> 2500; '₹1 lakh' -> 100000.
 * Anything unreadable or below MIN_THRESHOLD falls back to 2000 (with a warning).
 */
function parseThreshold(label) {
  return thresholdOf(label).value;
}

function thresholdOf(label) {
  const text = String(label || '').trim();
  const m = /(\d[\d,]*(?:\.\d+)?)\s*(k|thousand|l|lakh|lac)?\b/i.exec(text);
  let value = m ? Number(m[1].replace(/,/g, '')) : NaN;
  const unit = (m?.[2] || '').toLowerCase();
  if (unit === 'k' || unit === 'thousand') value *= 1000;
  else if (unit) value *= 100000;
  if (!Number.isFinite(value) || value < MIN_THRESHOLD) {
    if (text) warnOnce(`kundali.threshold "${text}" is not a usable amount (minimum ₹${MIN_THRESHOLD}); using ₹${DEFAULT_THRESHOLD}.`);
    return { value: DEFAULT_THRESHOLD, ok: false };
  }
  return { value: Math.round(value), ok: true };
}

/** CMS threshold (single source of truth). */
async function getThreshold() {
  const stored = await SiteContent.findOne({ key: 'main' }).lean();
  const label = String(mergeHomeContent(stored)?.kundali?.threshold || '').trim();
  const { value, ok } = thresholdOf(label);
  return { value, label: ok ? label : `₹${value.toLocaleString('en-IN')}` };
}

/* ---------------- launch cutoff ---------------- */

let eligibleFromCache = null;

/** KUNDLI_ELIGIBLE_FROM as a Date: 'YYYY-MM-DD' is midnight IST; any other ISO string is used as is. */
function envEligibleFrom() {
  const raw = String(process.env.KUNDLI_ELIGIBLE_FROM || '').trim();
  if (!raw) return null;
  const d = DATE_RX.test(raw) ? new Date(`${raw}T00:00:00+05:30`) : new Date(raw);
  if (Number.isNaN(d.getTime())) {
    warnOnce(`KUNDLI_ELIGIBLE_FROM "${raw}" is not a valid date; using the stored launch date.`);
    return null;
  }
  return d;
}

/**
 * Orders confirmed (paid or delivered) before this date never unlock a Kundli.
 * KUNDLI_ELIGIBLE_FROM wins; otherwise the date the Kundli settings document was first created (the first
 * start of this version), stored in Mongo so it never moves on a restart or a second instance.
 */
async function getEligibleFrom() {
  const fromEnv = envEligibleFrom();
  if (fromEnv) return fromEnv;
  if (eligibleFromCache) return eligibleFromCache;
  let doc;
  try {
    doc = await KundliSetting.findOneAndUpdate(
      { key: 'main' },
      { $setOnInsert: { key: 'main', eligibleFrom: new Date() } },
      { upsert: true, returnDocument: 'after' }
    ).lean();
  } catch (err) {
    if (err.code !== 11000) throw err;
    doc = await KundliSetting.findOne({ key: 'main' }).lean(); // created concurrently
  }
  eligibleFromCache = doc.eligibleFrom;
  return eligibleFromCache;
}

/* ---------------- qualifying orders ---------------- */

// Decision: an order qualifies on its goods value after discounts (subtotal − discount), excluding
// shipping and GST, less any partial refund. Same base as the free-shipping threshold in checkoutService.
function qualifyingAmount(order) {
  const goods = (Number(order?.subtotal) || 0) - (Number(order?.discount) || 0);
  return Math.max(0, goods - (Number(order?.payment?.refundedAmount) || 0));
}

function firstTimeline(order, status) {
  const hit = (order?.timeline || []).find((t) => t && t.status === status && t.at);
  return hit ? new Date(hit.at) : null;
}

/** When the order became confirmed: delivery for COD, payment capture otherwise. */
function confirmedAt(order) {
  if (order?.payment?.method === 'cod') return firstTimeline(order, 'delivered') || (order.updatedAt ? new Date(order.updatedAt) : null);
  return (order?.payment?.capturedAt && new Date(order.payment.capturedAt)) || firstTimeline(order, 'paid') || (order?.updatedAt ? new Date(order.updatedAt) : null);
}

/**
 * Whether an order unlocks the Kundli right now. COD: delivered. Cashfree / UPI / other: payment paid.
 * Never cancelled, returned or refunded; confirmed at or after `from`; goods value >= `min` (unless
 * `min` is omitted, used when re-checking an order that was already accepted).
 */
function orderQualifies(order, { min, from } = {}) {
  if (!order || CLOSED_STATUSES.includes(order.status)) return false;
  if (order.payment?.status === 'refunded') return false;
  const confirmed = order.payment?.method === 'cod' ? order.status === 'delivered' : order.payment?.status === 'paid';
  if (!confirmed) return false;
  if (from) {
    const at = confirmedAt(order);
    if (!at || at < from) return false;
  }
  if (min !== undefined && qualifyingAmount(order) < min) return false;
  return true;
}

const ORDER_FIELDS = '_id orderNumber userId email subtotal discount status payment timeline createdAt updatedAt';

async function findQualifyingOrder(userId, min, from) {
  if (!userId) return null;
  const candidates = await Order.find({
    userId,
    status: { $nin: CLOSED_STATUSES },
    'payment.status': { $ne: 'refunded' },
    $or: [
      { 'payment.method': 'cod', status: 'delivered' },
      { 'payment.method': { $ne: 'cod' }, 'payment.status': 'paid' },
    ],
    $expr: { $gte: [{ $subtract: ['$subtotal', { $ifNull: ['$discount', 0] }] }, min] },
  })
    .sort({ createdAt: 1 })
    .select(ORDER_FIELDS)
    .limit(50)
    .lean();
  return candidates.find((o) => orderQualifies(o, { min, from })) || null;
}

/* ---------------- birth details ---------------- */

/** UTC offset in hours of `timezoneId` at the given local wall time (DST aware). */
function tzOffsetHours(timezoneId, dob, tob) {
  const [y, mo, d] = dob.split('-').map(Number);
  const [h, mi] = tob.split(':').map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const offsetAt = (instant) => {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: timezoneId, timeZoneName: 'longOffset' })
      .formatToParts(new Date(instant))
      .find((p) => p.type === 'timeZoneName')?.value;
    const m = /GMT([+-])(\d{1,2})(?::?(\d{2}))?/.exec(part || '');
    if (!m) return 0; // 'GMT' alone = UTC
    return (m[1] === '-' ? -1 : 1) * (Number(m[2]) + Number(m[3] || 0) / 60);
  };
  // Two passes: the offset at the wall time read as UTC, then at the corrected instant.
  const first = offsetAt(wall);
  return offsetAt(wall - first * 3600 * 1000);
}

function validTimezone(timezoneId) {
  if (!timezoneId || typeof timezoneId !== 'string' || timezoneId.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezoneId });
    return true;
  } catch {
    return false;
  }
}

function toNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return NaN;
}

/** Validates customer/admin input into the stored `birth` shape. Throws 400 with a readable message. */
function cleanBirth(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw badRequest('Birth details are required.');
  const name = toStr(raw.name, 100);
  if (!name) throw badRequest('Please enter the full name.');
  const gender = toStr(raw.gender, 10).toLowerCase();
  if (!['male', 'female'].includes(gender)) throw badRequest('Please choose a gender.');

  const dob = toStr(raw.dob, 10);
  const dm = DATE_RX.exec(dob);
  const date = dm ? new Date(Date.UTC(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]))) : null;
  if (!date || date.getUTCMonth() !== Number(dm[2]) - 1 || date.getUTCDate() !== Number(dm[3]) || Number(dm[1]) < 1900) {
    throw badRequest('Please enter a valid date of birth.');
  }
  if (date.getTime() > Date.now()) throw badRequest('The date of birth cannot be in the future.');

  const tobUnknown = raw.tobUnknown === true || raw.tobUnknown === 'true';
  let tob = '12:00';
  if (!tobUnknown) {
    tob = toStr(raw.tob, 5);
    if (!TIME_RX.test(tob)) throw badRequest('Please enter the time of birth (HH:mm), or tick "I don\'t know my birth time".');
  }

  const place = toStr(raw.place, 200);
  const lat = toNumber(raw.lat);
  const lon = toNumber(raw.lon);
  if (!place || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw badRequest('Please choose the place of birth from the suggestions.');
  }
  const timezoneId = toStr(raw.timezoneId, 64);
  if (!validTimezone(timezoneId)) throw badRequest('Please choose the place of birth from the suggestions.');

  return {
    name,
    gender,
    dob,
    tob,
    tobUnknown,
    place,
    lat: Math.round(lat * 1e4) / 1e4,
    lon: Math.round(lon * 1e4) / 1e4,
    timezoneId,
    tzone: tzOffsetHours(timezoneId, dob, tob),
  };
}

function plainBirth(birth) {
  if (!birth) return birth;
  return typeof birth.toObject === 'function' ? birth.toObject() : { ...birth };
}

function sameBirth(a, b) {
  if (!a || !b) return false;
  return ['name', 'gender', 'dob', 'tob', 'tobUnknown', 'place', 'lat', 'lon', 'timezoneId'].every((k) => String(a[k] ?? '') === String(b[k] ?? ''));
}

function hasBirth(kundli) {
  return Boolean(kundli?.birth?.dob && kundli.birth.timezoneId);
}

/* ---------------- run state ---------------- */

/** True while a run is genuinely in progress (a stale 'queued'/'generating' does not count). */
function isRunning(kundli, now = Date.now()) {
  const t = Number(now);
  if (kundli?.status === 'generating') return Boolean(kundli.runStartedAt) && new Date(kundli.runStartedAt).getTime() > t - RUN_STALE_MS;
  if (kundli?.status === 'queued') return Boolean(kundli.queuedAt) && new Date(kundli.queuedAt).getTime() > t - QUEUE_STALE_MS;
  return false;
}

function staleRunFilter(now) {
  const t = Number(now);
  return [
    { status: 'queued', $or: [{ queuedAt: { $lt: new Date(t - QUEUE_STALE_MS) } }, { queuedAt: { $exists: false } }] },
    { status: 'generating', $or: [{ runStartedAt: { $lt: new Date(t - RUN_STALE_MS) } }, { runStartedAt: { $exists: false } }] },
  ];
}

function notRunningFilter(now) {
  return { $or: [{ status: { $nin: RUNNING } }, ...staleRunFilter(now)] };
}

/* ---------------- records ---------------- */

async function findForUser(user) {
  if (!user?._id) return null;
  return Kundli.findOne({ userId: user._id });
}

async function findOrCreateForUser(user, defaults = {}) {
  const found = await findForUser(user);
  if (found) return found;
  try {
    return await Kundli.create({ userId: user._id, email: String(user.email || '').toLowerCase() || undefined, ...defaults });
  } catch (err) {
    if (err.code === 11000) return Kundli.findOne({ userId: user._id });
    throw err;
  }
}

async function markEligible(kundli, order) {
  if (!order?._id || kundli.eligibleOrderId) return kundli;
  const now = new Date();
  // Recorded once: a later order never moves a valid eligibility.
  const res = await Kundli.updateOne(
    { _id: kundli._id, eligibleOrderId: { $exists: false } },
    { $set: { eligibleOrderId: order._id, eligibleOrderNumber: order.orderNumber, eligibleAt: now } }
  );
  if (res.modifiedCount) {
    kundli.eligibleOrderId = order._id;
    kundli.eligibleOrderNumber = order.orderNumber;
    kundli.eligibleAt = now;
  }
  return kundli;
}

/**
 * Re-checks the Kundli's eligibility against the orders as they are now. Keeps a still-valid eligible
 * order; otherwise moves to another qualifying order, or clears the eligibility. Returns true if eligible.
 */
async function ensureEligible(kundli, ctx) {
  if (!kundli?.userId) return false;
  const { threshold, from } = ctx || { threshold: await getThreshold(), from: await getEligibleFrom() };
  if (kundli.eligibleOrderId) {
    const current = await Order.findById(kundli.eligibleOrderId).select(ORDER_FIELDS).lean();
    // An order that was accepted stays accepted while it is valid, even if the threshold changes later.
    if (orderQualifies(current, { from })) return true;
  }
  const other = await findQualifyingOrder(kundli.userId, threshold.value, from);
  if (other) {
    const now = new Date();
    await Kundli.updateOne({ _id: kundli._id }, { $set: { eligibleOrderId: other._id, eligibleOrderNumber: other.orderNumber, eligibleAt: now } });
    kundli.eligibleOrderId = other._id;
    kundli.eligibleOrderNumber = other.orderNumber;
    kundli.eligibleAt = now;
    return true;
  }
  if (kundli.eligibleOrderId) {
    await Kundli.updateOne({ _id: kundli._id }, { $unset: { eligibleOrderId: 1, eligibleOrderNumber: 1, eligibleAt: 1 } });
    kundli.eligibleOrderId = undefined;
    kundli.eligibleOrderNumber = undefined;
    kundli.eligibleAt = undefined;
  }
  return false;
}

/** Fire-and-forget generation; errors are logged, never thrown into the caller. */
function startGeneration(kundliId) {
  generate(kundliId).catch((err) => console.error(`[kundli] generation ${kundliId} failed:`, err.message));
}

/**
 * The only way into a run: an atomic transition to 'queued' that never matches a record whose run is in
 * progress (a stale one may be replaced). `allow` limits the statuses it may start from; `filter` adds
 * conditions (e.g. a counter below its cap); `set`/`inc` are applied in the same write. Returns the
 * queued record, or null when nothing was queued.
 */
async function queue(kundliId, { by = 'system', allow, filter = {}, set = {}, inc = {} } = {}) {
  const now = new Date();
  // Needs birth details: already stored, or written by this same update.
  const match = { _id: kundliId, ...(set.birth?.dob ? {} : { 'birth.dob': { $exists: true } }), ...filter, $and: [notRunningFilter(now)] };
  if (allow) match.$and.push({ status: { $in: allow } });
  const update = { $set: { ...set, status: 'queued', queuedAt: now, runBy: by } };
  if (Object.keys(inc).length) update.$inc = inc;
  const doc = await Kundli.findOneAndUpdate(match, update, { returnDocument: 'after' });
  if (doc) startGeneration(doc._id);
  return doc;
}

/** Re-runs records whose run died (restart/crash): stale 'queued' and stale 'generating'. */
async function sweepStale() {
  const stale = await Kundli.find({ $or: staleRunFilter(new Date()) }).select('_id').limit(25).lean();
  for (const { _id } of stale) startGeneration(_id);
  return stale.length;
}

let sweepTimer = null;
/** Called once after the DB connects: fixes the launch cutoff and starts the stale-run sweep. */
async function startKundliJobs() {
  const from = await getEligibleFrom();
  console.log(`[kundli] orders confirmed from ${from.toISOString()} unlock the free Kundli${envEligibleFrom() ? ' (KUNDLI_ELIGIBLE_FROM)' : ''}.`);
  const run = () => sweepStale().catch((err) => console.warn('[kundli] sweep:', err.message));
  if (!sweepTimer) {
    sweepTimer = setInterval(run, SWEEP_MS);
    sweepTimer.unref();
  }
  run();
}

/* ---------------- customer actions ---------------- */

/**
 * Saves birth details (home modal or Account → My Kundli; signed in only) and starts generation when the
 * customer is eligible.
 * - Not generated yet: generates when an eligible order exists, otherwise waits for one.
 * - Failed (no good Kundli yet): a retry, at most KUNDLI_CUSTOMER_RETRY_CAP times, 10 min apart.
 * - Generated: a regeneration with new details, once a day, at most KUNDLI_CUSTOMER_REGEN_CAP times.
 */
async function saveDetails({ user, details }) {
  if (!user?._id) throw badRequest('Please sign in to save your birth details.', 401);
  const birth = cleanBirth(details);
  const now = Date.now();
  const kundli = await findOrCreateForUser(user, { status: 'awaiting_order' });
  if (isRunning(kundli, now)) throw badRequest('Your Kundli is being prepared. Please try again in a minute.', 409);

  const generated = Boolean(kundli.generatedAt);
  const failedFirst = kundli.status === 'failed' && !generated;
  const shown = kundli.generatedBirth || kundli.birth;
  if (generated && kundli.status === 'ready' && sameBirth(shown, birth)) return { kundli, status: kundli.status };

  const set = { birth, language: 'en' };
  if (!kundli.email && user.email) set.email = String(user.email).toLowerCase();
  const since = (d) => (d ? now - new Date(d).getTime() : Infinity);

  if (generated || failedFirst) {
    if (since(kundli.runStartedAt) < CUSTOMER_RETRY_GAP_MS) {
      throw badRequest(`Please wait a few minutes before trying again (after ${istWhen(new Date(kundli.runStartedAt).getTime() + CUSTOMER_RETRY_GAP_MS)}).`, 429);
    }
    let filter;
    let inc;
    if (generated) {
      if ((kundli.customerRegens || 0) >= regenCap()) {
        throw badRequest('Your Kundli has already been updated the maximum number of times. Please contact us to change the birth details.', 429, 'regen_cap');
      }
      if (since(kundli.generatedAt) < CUSTOMER_COOLDOWN_MS) {
        throw badRequest(`Birth details can be changed once a day. You can update them again after ${istWhen(new Date(kundli.generatedAt).getTime() + CUSTOMER_COOLDOWN_MS)}.`, 429);
      }
      filter = { customerRegens: { $not: { $gte: regenCap() } } };
      inc = { customerRegens: 1 };
    } else {
      if ((kundli.customerRetries || 0) >= retryCap()) {
        throw badRequest('We could not prepare your Kundli after several tries. Our team has been notified and will contact you.', 429, 'retry_cap');
      }
      filter = { customerRetries: { $not: { $gte: retryCap() } } };
      inc = { customerRetries: 1 };
    }
    if (!(await ensureEligible(kundli))) {
      throw badRequest('Your qualifying order is no longer active, so the Kundli cannot be prepared again.', 409);
    }
    const queued = await queue(kundli._id, { by: 'customer', allow: ['ready', 'failed'], filter, set, inc });
    if (!queued) throw badRequest('Your Kundli is being prepared. Please try again in a minute.', 409);
    return { kundli: queued, status: queued.status };
  }

  // Not generated yet (awaiting order / details needed).
  Object.assign(kundli, set);
  if (await ensureEligible(kundli)) {
    const queued = await queue(kundli._id, { by: 'customer', allow: ['awaiting_order', 'details_needed'], set });
    if (queued) return { kundli: queued, status: queued.status };
    throw badRequest('Your Kundli is being prepared. Please try again in a minute.', 409);
  }
  const saved = await Kundli.findOneAndUpdate(
    { _id: kundli._id, status: { $in: ['awaiting_order', 'details_needed'] } },
    { $set: { ...set, status: 'awaiting_order' } },
    { returnDocument: 'after' }
  );
  if (!saved) throw badRequest('Your Kundli is being prepared. Please try again in a minute.', 409);
  return { kundli: saved, status: saved.status };
}

/** POST /api/kundli/retry: re-runs a failed Kundli with the saved details (same limits as an edit). */
async function retry(user) {
  const kundli = await findForUser(user);
  if (!kundli || kundli.status !== 'failed' || !hasBirth(kundli)) throw badRequest('There is nothing to retry.', 409);
  return saveDetails({ user, details: plainBirth(kundli.birth) });
}

/**
 * Order hook: Cashfree payment (cashfreeService) and the Order save hooks (admin marks a payment paid,
 * a status becomes delivered, iThink tracking). Re-reads the order, so it is safe to call with a stale
 * copy and more than once. Callers must not await it into checkout or the save path.
 */
async function onOrderConfirmed(orderLike) {
  if (!orderLike?._id) return null;
  const order = await Order.findById(orderLike._id).select(ORDER_FIELDS).lean();
  if (!order?.userId) return null;
  const [threshold, from] = await Promise.all([getThreshold(), getEligibleFrom()]);
  if (!orderQualifies(order, { min: threshold.value, from })) return null;

  const user = (await User.findById(order.userId).select('email').lean()) || { _id: order.userId };
  const kundli = await findOrCreateForUser({ _id: order.userId, email: user.email || order.email }, { status: 'details_needed' });
  await markEligible(kundli, order);

  // Never regenerates a ready (or running) Kundli because of another order: only these statuses start.
  if (hasBirth(kundli)) return (await queue(kundli._id, { by: 'system', allow: ['awaiting_order', 'details_needed'] })) || kundli;
  await Kundli.updateOne({ _id: kundli._id, status: 'awaiting_order' }, { $set: { status: 'details_needed' } });
  return kundli;
}

/* ---------------- generation ---------------- */

function birthBody(birth) {
  const [year, month, day] = birth.dob.split('-').map(Number);
  const [hour, min] = birth.tob.split(':').map(Number);
  return { day, month, year, hour, min, lat: birth.lat, lon: birth.lon, tzone: birth.tzone };
}

async function pdfFields(birth, body) {
  const settings = (await StoreSettings.findOne({ key: 'store' }).lean()) || {};
  const site = String(process.env.FRONTEND_URL || 'https://beads-front-end.vercel.app').replace(/\/$/, '');
  const storeName = settings.storeName || 'Kuberstones';
  const info = `${storeName}: natural crystals, rudraksha and gemstones, energised and hand-finished. This Kundli is complimentary with your order.`;
  return {
    name: birth.name,
    gender: birth.gender,
    ...body,
    place: birth.place,
    language: 'en',
    chart_style: 'NORTH_INDIAN',
    footer_link: site,
    logo_url: '', // branding images are out of scope
    company_name: storeName,
    company_info: info.slice(0, 499),
    domain_url: site,
    company_email: settings.email || '',
    company_landline: '',
    company_mobile: settings.phone || '',
  };
}

function svgFrom(res) {
  const svg = typeof res === 'string' ? res : res?.svg || res?.chart || '';
  if (!astrology.looksLikeSvg(svg)) throw new Error('AstrologyAPI chart response had no SVG.');
  return String(svg);
}

// Runs tasks with at most `limit` in flight.
async function pool(tasks, limit) {
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const task = tasks[next];
      next += 1;
      await task();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
}

function hasSections(kundli) {
  const s = kundli?.sections || {};
  return Kundli.KUNDLI_SECTIONS.some((k) => s[k] !== undefined && s[k] !== null);
}

/**
 * Runs a queued Kundli: calls the 8 Standard endpoints and stores the result. Partial results are kept:
 * 'ready' when at least one data section succeeded (a PDF failure alone never fails it), 'failed' when
 * every data section failed. A failed regeneration keeps the previous good Kundli. Only a 'queued' (or a
 * stale 'generating') record can be claimed, atomically, so a Kundli never runs twice at once.
 */
async function generate(kundliId) {
  if (!mongoose.isValidObjectId(kundliId)) throw badRequest('Kundli not found.', 404);
  const now = new Date();
  const current = await Kundli.findById(kundliId);
  if (!current) return null;
  const claimable = current.status === 'queued' || (current.status === 'generating' && !isRunning(current, now));
  if (!claimable || !hasBirth(current)) return current;

  const hadGood = Boolean(current.generatedAt) && hasSections(current);
  // Eligibility is re-checked at run time (the order may have been cancelled, returned or refunded since).
  // Admin regenerations are the admin's call.
  if (current.runBy !== 'admin' && !(await ensureEligible(current))) {
    const $set = { status: hadGood ? 'ready' : 'awaiting_order', lastError: 'The qualifying order is no longer active.' };
    if (hadGood && current.generatedBirth) $set.birth = plainBirth(current.generatedBirth);
    await Kundli.updateOne({ _id: current._id, status: current.status, queuedAt: current.queuedAt }, { $set });
    return Kundli.findById(current._id);
  }

  const kundli = await Kundli.findOneAndUpdate(
    { _id: current._id, 'birth.dob': { $exists: true }, $or: [{ status: 'queued' }, staleRunFilter(now)[1]] },
    { $set: { status: 'generating', runStartedAt: now }, $inc: { attempts: 1 } },
    { returnDocument: 'after' }
  );
  if (!kundli) return Kundli.findById(current._id); // claimed by another run

  const body = birthBody(kundli.birth);
  const sections = {};
  const errors = {};
  let calls = 0;
  let fatal = null; // credentials / credits: the remaining calls would fail the same way
  let pdfUrl;

  const step = (key, fn) => async () => {
    if (fatal) {
      errors[key] = fatal.message;
      return;
    }
    try {
      sections[key] = await fn();
      calls += 1;
    } catch (err) {
      // Only requests that reached AstrologyAPI count (not "not configured" or a network failure).
      if (err.billed !== false) calls += 1;
      errors[key] = err.message || 'Request failed.';
      if (['auth', 'credits', 'not_configured'].includes(err.code)) fatal = err;
    }
  };

  await pool(
    [
      step('astro', () => astrology.call('astro_details', body)),
      step('planets', () => astrology.call('planets', body)),
      step('chartSvg', async () => svgFrom(await astrology.call('horo_chart_image/D1', { ...body, chartType: 'north', image_type: 'svg' }))),
      step('dasha', () => astrology.call('current_vdasha', body)),
      step('manglik', () => astrology.call('manglik', body)),
      step('gems', () => astrology.call('basic_gem_suggestion', body)),
      step('rudraksha', () => astrology.call('rudraksha_suggestion', body)),
      step('pdf', async () => {
        pdfUrl = await astrology.horoscopePdf(await pdfFields(kundli.birth, body));
        return undefined;
      }),
    ],
    CONCURRENCY
  );

  delete sections.pdf;
  const dataKeys = Kundli.KUNDLI_SECTIONS;
  const failedKeys = Object.keys(errors);
  const okData = dataKeys.filter((k) => sections[k] !== undefined && !errors[k]);
  const status = okData.length ? 'ready' : 'failed';
  const runError = status === 'failed'
    ? fatal?.message || errors.astro || Object.values(errors)[0] || 'Generation failed.'
    : failedKeys.length
      ? `Missing: ${failedKeys.join(', ')}.`
      : undefined;

  let $set;
  const $unset = {};
  const $inc = { apiCalls: calls };
  const keptPrevious = status === 'failed' && hadGood;
  if (keptPrevious) {
    // A failed regeneration never wipes a good Kundli: keep its sections, PDF and the birth details they
    // were made from; record the error only.
    $set = { status: 'ready', lastError: `Regeneration failed: ${runError}`, updateFailedAt: new Date() };
    if (kundli.generatedBirth) $set.birth = plainBirth(kundli.generatedBirth);
  } else {
    $set = {
      status,
      sections: { ...Object.fromEntries(dataKeys.map((k) => [k, sections[k]]).filter(([, v]) => v !== undefined)), errors },
    };
    if (pdfUrl) $set.pdfUrl = pdfUrl;
    else $unset.pdfUrl = 1;
    if (status === 'ready') {
      $set.generatedAt = new Date();
      $set.generatedBirth = plainBirth(kundli.birth);
      $unset.updateFailedAt = 1;
    }
    if (runError) $set.lastError = runError;
    else $unset.lastError = 1;
  }

  // Only the run that holds the claim writes its result.
  const saved = await Kundli.findOneAndUpdate(
    { _id: kundli._id, runStartedAt: now },
    { $set, ...(Object.keys($unset).length ? { $unset } : {}), $inc },
    { returnDocument: 'after' }
  );
  if (!saved) await Kundli.updateOne({ _id: kundli._id }, { $inc: { apiCalls: calls } });

  if (failedKeys.length) {
    const who = kundli.birth?.name || kundli.email || String(kundli._id);
    let title = `Kundli for ${who} is missing ${failedKeys.length} section(s)`;
    if (keptPrevious) title = `Kundli regeneration failed for ${who} (previous Kundli kept)`;
    else if (status === 'failed') title = `Kundli generation failed for ${who}`;
    try {
      await notify({
        type: 'system',
        title,
        body: String(runError || '').slice(0, 280),
        link: '/admin/kundli',
        meta: { kundliId: kundli._id, errors },
      });
    } catch (err) {
      console.warn('[kundli] notify failed:', err.message);
    }
  }
  return saved || Kundli.findById(kundli._id);
}

/* ---------------- place search ---------------- */

const PLACE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const placesDailyCap = () => envInt('KUNDLI_PLACES_DAILY_CAP', 500);

function istDay(date = new Date()) {
  return new Date(date.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function countryName(code) {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(String(code).toUpperCase()) || code;
  } catch {
    return code || '';
  }
}

/** Reserves one uncached geo_details lookup in today's (IST) global budget. False once the cap is reached. */
async function reservePlaceLookup() {
  const cap = placesDailyCap();
  if (cap <= 0) return false;
  const day = istDay();
  const inc = { $inc: { count: 1 } };
  try {
    const doc = await KundliPlaceQuota.findOneAndUpdate(
      { _id: day, count: { $lt: cap } },
      { ...inc, $setOnInsert: { expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) } },
      { upsert: true, returnDocument: 'after' }
    );
    return Boolean(doc);
  } catch (err) {
    if (err.code !== 11000) throw err;
    // Today's counter exists (created concurrently, or the cap is reached): increment it only if under the cap.
    return Boolean(await KundliPlaceQuota.findOneAndUpdate({ _id: day, count: { $lt: cap } }, inc));
  }
}

/**
 * geo_details proxy: "City, Country" options with coordinates and IANA time zone. Results are cached in
 * Mongo per query (30 days, shared by every instance); new lookups are capped per IST day.
 */
async function searchPlaces(rawQuery) {
  const q = toStr(rawQuery, 60).replace(/\s+/g, ' ').toLowerCase();
  if (q.length < 3) throw badRequest('Type at least 3 letters of the place.');
  const cached = await KundliPlaceCache.findOne({ q, expiresAt: { $gt: new Date() } }).lean();
  if (cached) return cached.places;

  if (!(await reservePlaceLookup())) {
    warnOnce(`Place search daily cap (${placesDailyCap()}) reached for ${istDay()}.`);
    throw badRequest('Place search is busy, please try again later.', 429, 'places_cap');
  }
  const res = await astrology.call('geo_details', { place: q, maxRows: 6 });
  const places = (Array.isArray(res?.geonames) ? res.geonames : [])
    .map((g) => {
      const lat = toNumber(g.latitude);
      const lon = toNumber(g.longitude);
      const country = countryName(g.country_code);
      const name = String(g.place_name || '').trim();
      return {
        label: [name, country].filter(Boolean).join(', '),
        name,
        country,
        countryCode: g.country_code || '',
        lat,
        lon,
        timezoneId: g.timezone_id || '',
      };
    })
    .filter((p) => p.name && Number.isFinite(p.lat) && Number.isFinite(p.lon) && validTimezone(p.timezoneId));

  try {
    await KundliPlaceCache.updateOne({ q }, { $set: { places, expiresAt: new Date(Date.now() + PLACE_CACHE_TTL_MS) } }, { upsert: true });
  } catch (err) {
    if (err.code !== 11000) console.warn('[kundli] place cache write failed:', err.message);
  }
  return places;
}

/* ---------------- product suggestions ---------------- */

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen'];

/** "Five Faced" / "5 Mukhi" -> ['five mukhi', '5 mukhi'] ("5-mukhi" also matches: [\s-]* in matchCards). */
function rudrakshaTerms(name) {
  const text = typeof name === 'string' ? name.toLowerCase() : '';
  const digit = /(?<!\d)(\d{1,2})(?!\d)/.exec(text)?.[1];
  const wordIdx = NUMBER_WORDS.findIndex((w) => new RegExp(`\\b${w}\\b`).test(text));
  const n = digit ? Number(digit) : wordIdx > 0 ? wordIdx : null;
  if (!n) return text ? [text.replace(/\b(faced|face|mukhi|rudraksha)\b/g, '').trim()].filter(Boolean) : [];
  return [`${NUMBER_WORDS[n] || n} mukhi`, `${n} mukhi`];
}

function gemTerms(gem) {
  if (!gem || typeof gem !== 'object') return [];
  const semi = String(typeof gem.semi_gem === 'string' ? gem.semi_gem : '')
    .split(/,|\/|\bor\b|\band\b/i)
    .map((s) => s.trim());
  return [typeof gem.name === 'string' ? gem.name : '', ...semi].map((s) => String(s || '').trim()).filter((s) => s.length >= 3);
}

async function matchCards(terms, limit = 3) {
  const unique = [...new Set(terms.map((t) => t.toLowerCase()))];
  if (!unique.length) return [];
  // Leading boundary: "5 mukhi" must not match "15 Mukhi", "ruby" not "baruby".
  const rx = unique.map((t) => new RegExp(`(?<![\\da-z])${escapeRegex(t).replace(/[\s-]+/g, '[\\s-]*')}`, 'i'));
  const [products, beads] = await Promise.all([
    Product.find({ isActive: true, name: { $in: rx } }).select('name slug images price').limit(limit).lean(),
    Bead.find({ isActive: { $ne: false }, name: { $in: rx } }).select('name slug image images pricePerBead').limit(limit).lean(),
  ]);
  const cards = products.map((p) => ({ kind: 'product', name: p.name, slug: p.slug, image: p.images?.[0] || '', price: p.price, to: `/p/${p.slug}` }));
  for (const b of beads) {
    if (cards.length >= limit) break;
    cards.push({ kind: 'bead', name: b.name, slug: b.slug, image: b.image || b.images?.[0] || '', price: b.pricePerBead, to: '/customize' });
  }
  return cards.slice(0, limit);
}

/** Storefront products / studio beads matching the gemstone and rudraksha suggestions. Never throws. */
async function productsForSuggestions(kundli) {
  try {
    const gems = kundli?.sections?.gems && typeof kundli.sections.gems === 'object' ? kundli.sections.gems : {};
    const out = {};
    for (const key of ['LIFE', 'BENEFIC', 'LUCKY']) {
      if (gems[key]) out[key] = await matchCards(gemTerms(gems[key]));
    }
    const rud = kundli?.sections?.rudraksha;
    if (rud && typeof rud === 'object') {
      const key = typeof rud.rudraksha_key === 'string' ? rud.rudraksha_key.replace(/_/g, ' ') : '';
      out.rudraksha = await matchCards([...rudrakshaTerms(rud.name), ...rudrakshaTerms(key)]);
    }
    return out;
  } catch (err) {
    console.warn('[kundli] product suggestions failed:', err.message);
    return {};
  }
}

/* ---------------- views ---------------- */

/** Only https links from AstrologyAPI are stored or shown. */
function safePdfUrl(url) {
  return astrology.httpsUrl(url) || '';
}

/** Customer view: no internal counters or raw error text. */
function customerView(kundli, now = Date.now()) {
  if (!kundli) return null;
  const k = typeof kundli.toObject === 'function' ? kundli.toObject() : kundli;
  const errorKeys = Object.keys(k.sections?.errors || {});
  const { errors, ...sections } = k.sections || {};
  const generated = Boolean(k.generatedAt);
  const after = (d, ms) => (d && new Date(d).getTime() + ms > now ? new Date(new Date(d).getTime() + ms) : null);
  const gap = after(k.runStartedAt, CUSTOMER_RETRY_GAP_MS);
  const cooldown = generated ? after(k.generatedAt, CUSTOMER_COOLDOWN_MS) : null;
  const latest = [gap, cooldown].filter(Boolean).sort((a, b) => b - a)[0] || null;
  const regensLeft = Math.max(0, regenCap() - (k.customerRegens || 0));
  const retriesLeft = Math.max(0, retryCap() - (k.customerRetries || 0));
  const failedFirst = k.status === 'failed' && !generated;
  return {
    _id: k._id,
    status: k.status,
    // A ready Kundli shows the details it was calculated from.
    birth: (k.status === 'ready' && k.generatedBirth) || k.birth || null,
    sections,
    missing: errorKeys,
    pdfUrl: safePdfUrl(k.pdfUrl),
    generatedAt: k.generatedAt || null,
    eligibleOrderNumber: k.eligibleOrderNumber || '',
    eligibleAt: k.eligibleAt || null,
    updateFailed: Boolean(k.updateFailedAt) && k.status === 'ready',
    editableAfter: generated && k.status === 'ready' && regensLeft > 0 ? latest : null,
    regensLeft: generated ? regensLeft : null,
    editLocked: generated && regensLeft === 0,
    retry: failedFirst ? { left: retriesLeft, after: retriesLeft > 0 ? gap : null } : null,
  };
}

/**
 * GET /api/kundli/mine payload. Never creates a record: a customer with a qualifying order but no record
 * gets `eligible: true` and the details form; the record is created when the details are saved.
 * For an existing record it re-checks the eligibility, restarts a dead run, and (as a fallback for a
 * missed order hook) starts generation when the customer is eligible and has details.
 */
async function mine(user) {
  const [threshold, from] = await Promise.all([getThreshold(), getEligibleFrom()]);
  const base = { threshold: threshold.value, thresholdLabel: threshold.label };
  let kundli = await findForUser(user);
  if (!kundli) {
    const order = await findQualifyingOrder(user._id, threshold.value, from);
    return { ...base, kundli: null, eligible: Boolean(order), eligibleOrderNumber: order?.orderNumber || '', suggestions: {} };
  }

  const now = Date.now();
  if (RUNNING.includes(kundli.status) && !isRunning(kundli, now)) startGeneration(kundli._id);
  if (['awaiting_order', 'details_needed'].includes(kundli.status)) {
    const eligible = await ensureEligible(kundli, { threshold, from });
    if (eligible && hasBirth(kundli)) {
      kundli = (await queue(kundli._id, { by: 'system', allow: ['awaiting_order', 'details_needed'] })) || kundli;
    } else {
      const next = eligible ? 'details_needed' : 'awaiting_order';
      if (kundli.status !== next) {
        kundli = (await Kundli.findOneAndUpdate({ _id: kundli._id, status: kundli.status }, { $set: { status: next } }, { returnDocument: 'after' })) || kundli;
      }
    }
  }
  const ready = kundli.status === 'ready';
  return {
    ...base,
    kundli: customerView(kundli, now),
    eligible: Boolean(kundli.eligibleOrderId) || Boolean(kundli.generatedAt),
    eligibleOrderNumber: kundli.eligibleOrderNumber || '',
    suggestions: ready ? await productsForSuggestions(kundli) : {},
  };
}

/* ---------------- admin ---------------- */

/**
 * Admin/staff birth-details fix. Staff only save the details. An admin saving a record that is waiting for
 * details (and is eligible) starts generation; a generated Kundli keeps its result until Regenerate.
 */
async function adminSaveDetails(id, body, { role } = {}) {
  const doc = await Kundli.findById(id);
  if (!doc) throw badRequest('Kundli not found.', 404);
  if (isRunning(doc)) throw badRequest('This Kundli is being generated. Try again when it finishes.', 409);
  const birth = cleanBirth(body);
  if (role === 'admin' && doc.status === 'details_needed' && doc.eligibleOrderId && (await ensureEligible(doc))) {
    const queued = await queue(doc._id, { by: 'admin', allow: ['details_needed'], set: { birth } });
    if (queued) return queued;
  }
  const saved = await Kundli.findOneAndUpdate({ _id: doc._id, $and: [notRunningFilter(new Date())] }, { $set: { birth } }, { returnDocument: 'after' });
  if (!saved) throw badRequest('This Kundli is being generated. Try again when it finishes.', 409);
  return saved;
}

/** Admin Regenerate / Generate: no eligibility re-check or limits (each run spends credits). */
async function adminGenerate(id) {
  const doc = await Kundli.findById(id);
  if (!doc) throw badRequest('Kundli not found.', 404);
  if (!hasBirth(doc)) throw badRequest('Add the birth details first.');
  if (isRunning(doc)) throw badRequest('This Kundli is already being generated.', 409);
  const queued = await queue(doc._id, { by: 'admin' });
  if (!queued) throw badRequest('This Kundli is already being generated.', 409);
  return queued;
}

/** Rules shown on the admin Kundli page. */
async function adminRules() {
  const [threshold, from, today] = await Promise.all([getThreshold(), getEligibleFrom(), KundliPlaceQuota.findById(istDay()).lean()]);
  return {
    threshold: threshold.value,
    thresholdLabel: threshold.label,
    eligibleFrom: from,
    eligibleFromEnv: Boolean(envEligibleFrom()),
    customerRegenCap: regenCap(),
    customerRetryCap: retryCap(),
    places: { today: today?.count || 0, cap: placesDailyCap() },
  };
}

module.exports = {
  adminRules,
  getThreshold,
  parseThreshold,
  getEligibleFrom,
  qualifyingAmount,
  orderQualifies,
  confirmedAt,
  cleanBirth,
  tzOffsetHours,
  sameBirth,
  saveDetails,
  retry,
  onOrderConfirmed,
  generate,
  startGeneration,
  queue,
  sweepStale,
  startKundliJobs,
  isRunning,
  hasBirth,
  searchPlaces,
  productsForSuggestions,
  rudrakshaTerms,
  customerView,
  safePdfUrl,
  mine,
  adminSaveDetails,
  adminGenerate,
  CUSTOMER_COOLDOWN_MS,
};
