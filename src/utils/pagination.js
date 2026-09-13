function parsePage(req, defaultLimit = 20) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
}

function pageMeta(total, page, limit) {
  return {
    page,
    limit,
    total,
    pages: Math.max(1, Math.ceil((total || 0) / limit)),
  };
}

function parseSort(req, allowed = ['createdAt', 'name', 'updatedAt'], fallback = '-createdAt') {
  const raw = String(req.query.sort || fallback);
  const desc = raw.startsWith('-');
  const field = desc ? raw.slice(1) : raw;
  if (!allowed.includes(field)) return fallback;
  return desc ? `-${field}` : field;
}

module.exports = { parsePage, pageMeta, parseSort };
