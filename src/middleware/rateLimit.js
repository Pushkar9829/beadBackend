// Small fixed-window in-memory rate limiter. Per-process: put a shared store (e.g. Redis)
// in front if the API is ever scaled to several instances.
function rateLimit({ windowMs = 15 * 60 * 1000, max = 100, message = 'Too many requests. Please try again later.', key } = {}) {
  const hits = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, entry] of hits) if (entry.reset <= now) hits.delete(k);
  }, windowMs);
  timer.unref();

  return (req, res, next) => {
    const now = Date.now();
    const id = key ? key(req) : req.ip;
    let entry = hits.get(id);
    if (!entry || entry.reset <= now) {
      entry = { count: 0, reset: now + windowMs };
      hits.set(id, entry);
    }
    entry.count += 1;
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - entry.count)));
    if (entry.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((entry.reset - now) / 1000)));
      return res.status(429).json({ message });
    }
    next();
  };
}

module.exports = { rateLimit };
