const DEFAULT_API = 'https://beadbackend.onrender.com';

function trimSlash(value) {
  return String(value || '').trim().replace(/\/$/, '');
}

function publicApiOrigin(req) {
  const envUrl = trimSlash(process.env.API_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL);
  if (envUrl && !/localhost|127\.0\.0\.1/i.test(envUrl)) return envUrl;
  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') return DEFAULT_API;
  if (req) {
    // Only the Host header (never client-supplied X-Forwarded-Host) — dev/non-production fallback only.
    const host = String(req.get?.('host') || req.headers?.host || '').trim();
    if (host && /^[a-z0-9.-]+(:\d+)?$/i.test(host) && !/localhost|127\.0\.0\.1/i.test(host)) {
      // req.protocol honours X-Forwarded-Proto only from proxies trusted via app.set('trust proxy').
      const proto = req.protocol === 'http' ? 'http' : 'https';
      return trimSlash(`${proto}://${host}`);
    }
  }
  if (envUrl) return envUrl;
  return DEFAULT_API;
}

function webhookUrls(req) {
  const origin = publicApiOrigin(req);
  return {
    origin,
    cashfree: `${origin}/api/payments/cashfree/webhook`,
    ithink: `${origin}/api/shipping/ithink/webhook`,
    ithinkSync: `${origin}/api/shipping/ithink/sync`,
  };
}

module.exports = { publicApiOrigin, webhookUrls, DEFAULT_API };
