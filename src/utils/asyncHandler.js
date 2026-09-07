function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function slugifyName(name) {
  const slugify = require('slugify');
  return slugify(name, { lower: true, strict: true });
}

module.exports = { asyncHandler, slugifyName };
