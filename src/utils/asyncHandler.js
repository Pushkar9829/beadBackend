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

module.exports = { asyncHandler, slugifyName, escapeRegex, cleanBody, toStr, UPDATE_OPTS };
