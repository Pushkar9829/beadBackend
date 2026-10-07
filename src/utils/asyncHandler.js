function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function slugifyName(name) {
  const slugify = require('slugify');
  return slugify(String(name ?? ''), { lower: true, strict: true });
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Safely coerces an untrusted value to a trimmed string, optionally capped to `max` chars. */
function toStr(value, max) {
  if (value == null) return '';
  if (typeof value === 'object') return '';
  const s = String(value).trim();
  return max ? s.slice(0, max) : s;
}

function isUnsafeKey(key) {
  return typeof key !== 'string' || key.startsWith('$') || key.includes('.') || key === '__proto__' || key === 'constructor' || key === 'prototype';
}

function stripOperators(value, depth = 0) {
  if (depth > 20) return undefined;
  if (Array.isArray(value)) return value.map((v) => stripOperators(v, depth + 1));
  const proto = value && typeof value === 'object' ? Object.getPrototypeOf(value) : undefined;
  if (proto === Object.prototype || proto === null) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (isUnsafeKey(k)) continue;
      out[k] = stripOperators(v, depth + 1);
    }
    return out;
  }
  return value;
}

const ALWAYS_OMIT = ['_id', 'id', '__v', 'createdAt', 'updatedAt'];

/**
 * Prepares a request body for create/update:
 * - drops identity/timestamp keys and any extra `omit` keys (server-controlled fields)
 * - recursively strips keys starting with `$` or containing `.` so update operators
 *   and dotted paths cannot be injected into findByIdAndUpdate.
 */
function cleanBody(body = {}, { omit = [] } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
  const data = stripOperators(body);
  for (const key of [...ALWAYS_OMIT, ...omit]) delete data[key];
  return data;
}

/** Standard options for admin findByIdAndUpdate calls. */
const UPDATE_OPTS = Object.freeze({ returnDocument: 'after', runValidators: true });

function isPlainObject(value) {
  if (!value || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Flattens plain nested objects into dotted `$set` paths so an update merges into the stored
 * sub-document instead of replacing it: `{ seo: { title } }` -> `{ 'seo.title': title }`.
 * Arrays, ObjectIds, Dates and other non-plain values are kept as values. Empty objects are skipped.
 * Run AFTER cleanBody (cleanBody strips keys containing '.').
 */
function flattenForSet(obj, prefix = '', out = {}) {
  if (!isPlainObject(obj)) {
    if (prefix) out[prefix] = obj;
    return out;
  }
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value)) flattenForSet(value, path, out);
    else out[path] = value;
  }
  return out;
}

/** Returns a copy of `data` where the listed top-level keys holding plain objects are flattened into dotted paths. */
function mergeNestedKeys(data, keys) {
  const out = {};
  for (const [key, value] of Object.entries(data || {})) {
    if (keys.includes(key) && isPlainObject(value)) flattenForSet(value, key, out);
    else out[key] = value;
  }
  return out;
}

/**
 * Removes listed optional fields that were sent as null (or '') from `data` and returns them as a
 * `$unset` map, so the admin UI can clear a field by sending null.
 */
function takeNullsAsUnset(data, keys) {
  const $unset = {};
  for (const key of keys) {
    if (key in data && (data[key] === null || data[key] === '')) {
      delete data[key];
      $unset[key] = 1;
    }
  }
  return $unset;
}

/** Builds a Mongo update document from $set / $unset maps, omitting empty operators. */
function buildUpdate($set = {}, $unset = {}) {
  const update = {};
  if (Object.keys($set).length) update.$set = $set;
  if (Object.keys($unset).length) update.$unset = $unset;
  return update;
}

module.exports = {
  asyncHandler,
  slugifyName,
  escapeRegex,
  cleanBody,
  toStr,
  UPDATE_OPTS,
  isPlainObject,
  flattenForSet,
  mergeNestedKeys,
  takeNullsAsUnset,
  buildUpdate,
};
