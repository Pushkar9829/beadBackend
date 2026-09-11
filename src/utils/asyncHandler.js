function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function slugifyName(name) {
  const slugify = require('slugify');
  return slugify(name, { lower: true, strict: true });
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanBody(body = {}) {
  const data = { ...body };
  delete data._id;
  delete data.id;
  delete data.__v;
  delete data.createdAt;
  delete data.updatedAt;
  return data;
}

module.exports = { asyncHandler, slugifyName, escapeRegex, cleanBody };
