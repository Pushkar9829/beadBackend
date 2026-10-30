// Free Kundli (AstrologyAPI "Standard" set) for customers whose order reaches the CMS threshold
// (home content kundali.threshold, e.g. '₹2,000'). Flow: birth details are saved from the home modal or
// Account → My Kundli; a confirmed qualifying order (COD/UPI placement or Cashfree payment) makes the
// customer eligible; generation then runs once in the background and the result is stored.
const mongoose = require('mongoose');
const Kundli = require('../models/Kundli');
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
// Cancelled/returned orders never qualify. COD/UPI orders count once placed (that is their
// confirmation); Cashfree orders only once paid.
const CLOSED_STATUSES = ['cancelled', 'returned'];

function isConfirmed(order) {
  if (!order || CLOSED_STATUSES.includes(order.status)) return false;
  return !(order.status === 'pending_payment' && order.payment?.method === 'gateway');
}
const CONCURRENCY = 3;
// A 'generating' claim older than this is assumed crashed and may be taken over.
const STALE_RUN_MS = 5 * 60 * 1000;
// Customers may re-submit birth details (which regenerates, spending credits) once per day.
const CUSTOMER_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const EMAIL_RX = /^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,}$/;
const DATE_RX = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RX = /^([01]\d|2[0-3]):([0-5]\d)$/;

function badRequest(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/* ---------------- threshold ---------------- */

/** CMS threshold (single source of truth): '₹2,000' -> 2000; falls back to 2000. */
async function getThreshold() {
  const stored = await SiteContent.findOne({ key: 'main' }).lean();
  const label = String(mergeHomeContent(stored)?.kundali?.threshold || '').trim();
  const value = Number(label.replace(/[^\d.]/g, ''));
  return {
    value: Number.isFinite(value) && value > 0 ? value : DEFAULT_THRESHOLD,
    label: label || `₹${DEFAULT_THRESHOLD.toLocaleString('en-IN')}`,
  };
}

// Decision: an order qualifies on its goods value after discounts (subtotal − discount), excluding
// shipping and GST. Same base as the free-shipping threshold in checkoutService.
function qualifyingAmount(order) {
  return Math.max(0, (Number(order?.subtotal) || 0) - (Number(order?.discount) || 0));
}

async function findQualifyingOrder(userId, min) {
  if (!userId) return null;
  return Order.findOne({
    userId,
    status: { $nin: CLOSED_STATUSES },
    $nor: [{ status: 'pending_payment', 'payment.method': 'gateway' }],
    $expr: { $gte: [{ $subtract: ['$subtotal', { $ifNull: ['$discount', 0] }] }, min] },
  })
    .sort({ createdAt: 1 })
    .select('_id orderNumber createdAt')
    .lean();
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

function sameBirth(a, b) {
  if (!a || !b) return false;
  return ['name', 'gender', 'dob', 'tob', 'tobUnknown', 'place', 'lat', 'lon', 'timezoneId'].every((k) => String(a[k] ?? '') === String(b[k] ?? ''));
}

function hasBirth(kundli) {
  return Boolean(kundli?.birth?.dob && kundli.birth.timezoneId);
}

/* ---------------- records ---------------- */

/** The customer's Kundli; links an email-only (signed-out modal) record to the account on first sight. */
async function findForUser(user) {
  if (!user?._id) return null;
  const own = await Kundli.findOne({ userId: user._id });
  if (own) return own;
  const email = String(user.email || '').toLowerCase();
  if (!email) return null;
  try {
    return await Kundli.findOneAndUpdate(
      { email, userId: { $exists: false } },
      { $set: { userId: user._id } },
      { returnDocument: 'after', sort: { updatedAt: -1 } }
    );
  } catch (err) {
    if (err.code === 11000) return Kundli.findOne({ userId: user._id }); // linked concurrently
    throw err;
  }
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
  // Recorded once: a later order never moves the eligibility.
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

/** Fire-and-forget generation; errors are logged, never thrown into the caller. */
function startGeneration(kundliId, opts) {
  generate(kundliId, opts).catch((err) => console.error(`[kundli] generation ${kundliId} failed:`, err.message));
}

async function queue(kundli, { force = false } = {}) {
  kundli.status = 'queued';
  kundli.lastError = undefined;
  await kundli.save();
  startGeneration(kundli._id, { force });
  return kundli;
}

/**
 * Brings a customer's record up to date with their orders (also covers orders confirmed before this
 * feature, or paid by admin action): eligible + details -> generate; eligible without details -> ask.
 */
async function syncEligibility(kundli, user, threshold) {
  if (kundli && !['awaiting_order', 'details_needed'].includes(kundli.status)) return kundli;
  let doc = kundli;
  if (!doc?.eligibleOrderId) {
    const order = await findQualifyingOrder(user._id, threshold.value);
    if (!order) return doc;
    doc = doc || (await findOrCreateForUser(user, { status: 'details_needed' }));
    await markEligible(doc, order);
  }
  if (hasBirth(doc)) return queue(doc);
  if (doc.status !== 'details_needed') {
    doc.status = 'details_needed';
    await doc.save();
  }
  return doc;
}

/**
 * Saves birth details from the home modal or My Kundli.
 * Signed in (`user`): upsert by userId; generates when an eligible order exists.
 * Signed out (`email`): upsert an email-only record, linked to the account on its first qualifying order.
 */
async function saveDetails({ user, email, details }) {
  const birth = cleanBirth(details);

  if (!user) {
    const mail = toStr(email, 254).toLowerCase();
    if (!mail || !EMAIL_RX.test(mail)) throw badRequest('A valid email is required.');
    // A record already linked to an account is only changed by its signed-in owner (no details leak either).
    const linked = await Kundli.exists({ email: mail, userId: { $exists: true } });
    if (linked) return { kundli: null, status: 'awaiting_order' };
    const kundli = await Kundli.findOneAndUpdate(
      { email: mail, userId: { $exists: false } },
      { $set: { birth, language: 'en' }, $setOnInsert: { email: mail, status: 'awaiting_order' } },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );
    return { kundli, status: kundli.status };
  }

  const threshold = await getThreshold();
  const kundli = await findOrCreateForUser(user, { status: 'awaiting_order' });
  if (kundli.status === 'generating' || kundli.status === 'queued') {
    throw badRequest('Your Kundli is being prepared. Please try again in a minute.', 409);
  }
  const generated = ['ready', 'failed'].includes(kundli.status) && kundli.runStartedAt;
  if (generated && sameBirth(kundli.birth, birth)) return { kundli, status: kundli.status };
  if (generated) {
    const next = new Date(kundli.runStartedAt).getTime() + CUSTOMER_COOLDOWN_MS;
    if (next > Date.now()) {
      const when = new Date(next).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
      throw badRequest(`Birth details can be changed once a day. You can update them again after ${when}.`, 429);
    }
  }

  kundli.birth = birth;
  kundli.language = 'en';
  if (!kundli.email && user.email) kundli.email = String(user.email).toLowerCase();
  if (!kundli.eligibleOrderId) {
    const order = await findQualifyingOrder(user._id, threshold.value);
    if (order) await markEligible(kundli, order);
  }
  if (kundli.eligibleOrderId) {
    await queue(kundli, { force: true });
  } else {
    kundli.status = 'awaiting_order';
    await kundli.save();
  }
  return { kundli, status: kundli.status };
}

/**
 * Order hook (COD/UPI placement, Cashfree payment). Idempotent and safe to call more than once;
 * callers must not await it into checkout (see the call sites).
 */
async function onOrderConfirmed(order) {
  if (!order?.userId || !isConfirmed(order)) return null;
  const threshold = await getThreshold();
  if (qualifyingAmount(order) < threshold.value) return null;

  const user = (await User.findById(order.userId).select('email').lean()) || { _id: order.userId };
  const email = user.email || order.email;
  const kundli = await findOrCreateForUser({ _id: order.userId, email }, { status: 'details_needed' });
  await markEligible(kundli, order);

  // Never regenerate a ready (or running) Kundli because of another order.
  if (['ready', 'generating', 'queued'].includes(kundli.status)) return kundli;
  if (hasBirth(kundli)) return queue(kundli);
  if (kundli.status !== 'details_needed') {
    kundli.status = 'details_needed';
    await kundli.save();
  }
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
  if (!/^\s*<svg[\s>]/i.test(String(svg))) throw new Error('AstrologyAPI chart response had no SVG.');
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

/**
 * Calls the 8 Standard endpoints and stores the result. Partial results are kept: the Kundli is
 * 'ready' when at least one data section succeeded (a PDF failure alone never fails it), 'failed'
 * when every data section failed. An atomic claim prevents two runs at once.
 * `force` regenerates a Kundli that is already 'ready'.
 */
async function generate(kundliId, { force = false } = {}) {
  if (!mongoose.isValidObjectId(kundliId)) throw badRequest('Kundli not found.', 404);
  const now = new Date();
  const claimFilter = {
    _id: kundliId,
    'birth.dob': { $exists: true },
    $or: [{ status: { $ne: 'generating' } }, { runStartedAt: { $lt: new Date(now.getTime() - STALE_RUN_MS) } }],
  };
  if (!force) claimFilter.status = { $ne: 'ready' };
  const kundli = await Kundli.findOneAndUpdate(
    claimFilter,
    { $set: { status: 'generating', runStartedAt: now }, $inc: { attempts: 1 } },
    { returnDocument: 'after' }
  );
  if (!kundli) return Kundli.findById(kundliId); // already running, already ready, or no details

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
      calls += 1;
      sections[key] = await fn();
    } catch (err) {
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
  const lastError = status === 'failed'
    ? fatal?.message || errors.astro || Object.values(errors)[0] || 'Generation failed.'
    : failedKeys.length
      ? `Missing: ${failedKeys.join(', ')}.`
      : undefined;

  const $set = {
    status,
    sections: { ...Object.fromEntries(dataKeys.map((k) => [k, sections[k]]).filter(([, v]) => v !== undefined)), errors },
  };
  const $unset = {};
  if (pdfUrl) $set.pdfUrl = pdfUrl;
  else $unset.pdfUrl = 1;
  if (status === 'ready') $set.generatedAt = new Date();
  if (lastError) $set.lastError = lastError;
  else $unset.lastError = 1;

  // Only the run that holds the claim writes its result.
  const saved = await Kundli.findOneAndUpdate(
    { _id: kundli._id, runStartedAt: now },
    { $set, $unset, $inc: { apiCalls: calls } },
    { returnDocument: 'after' }
  );
  if (!saved) await Kundli.updateOne({ _id: kundli._id }, { $inc: { apiCalls: calls } });

  if (failedKeys.length) {
    const who = kundli.birth?.name || kundli.email || String(kundli._id);
    try {
      await notify({
        type: 'system',
        title: status === 'failed' ? `Kundli generation failed for ${who}` : `Kundli for ${who} is missing ${failedKeys.length} section(s)`,
        body: String(lastError || '').slice(0, 280),
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

const PLACE_TTL_MS = 24 * 60 * 60 * 1000;
const PLACE_CACHE_MAX = 500;
const placeCache = new Map();

function countryName(code) {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(String(code).toUpperCase()) || code;
  } catch {
    return code || '';
  }
}

/** geo_details proxy: "City, Country" options with coordinates and IANA time zone. Cached per query for 24h. */
async function searchPlaces(rawQuery) {
  const q = toStr(rawQuery, 60).replace(/\s+/g, ' ').toLowerCase();
  if (q.length < 3) throw badRequest('Type at least 3 letters of the place.');
  const hit = placeCache.get(q);
  if (hit && hit.at > Date.now() - PLACE_TTL_MS) return hit.places;

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

  if (placeCache.size >= PLACE_CACHE_MAX) placeCache.delete(placeCache.keys().next().value);
  placeCache.set(q, { at: Date.now(), places });
  return places;
}

/* ---------------- product suggestions ---------------- */

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen'];

/** "Five Faced" / "5 Mukhi" -> ['five mukhi', '5 mukhi', '5-mukhi']. */
function rudrakshaTerms(name) {
  const text = String(name || '').toLowerCase();
  const digit = /(\d{1,2})/.exec(text)?.[1];
  const wordIdx = NUMBER_WORDS.findIndex((w) => new RegExp(`\\b${w}\\b`).test(text));
  const n = digit ? Number(digit) : wordIdx > 0 ? wordIdx : null;
  if (!n) return text ? [text.replace(/\b(faced|face|mukhi|rudraksha)\b/g, '').trim()].filter(Boolean) : [];
  return [`${NUMBER_WORDS[n] || n} mukhi`, `${n} mukhi`, `${n}-mukhi`];
}

function gemTerms(gem) {
  if (!gem || typeof gem !== 'object') return [];
  const semi = String(gem.semi_gem || '')
    .split(/,|\/|\bor\b|\band\b/i)
    .map((s) => s.trim());
  return [gem.name, ...semi].map((s) => String(s || '').trim()).filter((s) => s.length >= 3);
}

async function matchCards(terms, limit = 3) {
  const unique = [...new Set(terms.map((t) => t.toLowerCase()))];
  if (!unique.length) return [];
  const rx = unique.map((t) => new RegExp(escapeRegex(t).replace(/[\s-]+/g, '[\\s-]*'), 'i'));
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

/** Storefront products / studio beads matching the gemstone and rudraksha suggestions. */
async function productsForSuggestions(kundli) {
  const gems = kundli?.sections?.gems || {};
  const out = {};
  for (const key of ['LIFE', 'BENEFIC', 'LUCKY']) {
    if (gems[key]) out[key] = await matchCards(gemTerms(gems[key]));
  }
  const rud = kundli?.sections?.rudraksha;
  if (rud) out.rudraksha = await matchCards([...rudrakshaTerms(rud.name), ...rudrakshaTerms(rud.rudraksha_key?.replace(/_/g, ' '))]);
  return out;
}

/* ---------------- views ---------------- */

/** Customer view: no internal counters or raw error text. */
function customerView(kundli) {
  if (!kundli) return null;
  const k = typeof kundli.toObject === 'function' ? kundli.toObject() : kundli;
  const errorKeys = Object.keys(k.sections?.errors || {});
  const cooldownUntil = k.runStartedAt ? new Date(new Date(k.runStartedAt).getTime() + CUSTOMER_COOLDOWN_MS) : null;
  const { errors, ...sections } = k.sections || {};
  return {
    _id: k._id,
    status: k.status,
    birth: k.birth || null,
    sections,
    missing: errorKeys,
    pdfUrl: k.pdfUrl || '',
    generatedAt: k.generatedAt || null,
    eligibleOrderNumber: k.eligibleOrderNumber || '',
    eligibleAt: k.eligibleAt || null,
    editableAfter: ['ready', 'failed'].includes(k.status) && cooldownUntil && cooldownUntil > new Date() ? cooldownUntil : null,
  };
}

/** GET /api/kundli/mine payload. */
async function mine(user) {
  const threshold = await getThreshold();
  let kundli = await findForUser(user);
  kundli = await syncEligibility(kundli, user, threshold);
  const ready = kundli?.status === 'ready';
  return {
    kundli: customerView(kundli),
    eligible: Boolean(kundli?.eligibleOrderId),
    threshold: threshold.value,
    thresholdLabel: threshold.label,
    suggestions: ready ? await productsForSuggestions(kundli) : {},
  };
}

module.exports = {
  getThreshold,
  qualifyingAmount,
  cleanBirth,
  tzOffsetHours,
  saveDetails,
  onOrderConfirmed,
  generate,
  startGeneration,
  queue,
  hasBirth,
  searchPlaces,
  productsForSuggestions,
  customerView,
  mine,
  CUSTOMER_COOLDOWN_MS,
};
