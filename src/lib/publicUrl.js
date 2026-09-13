const DEFAULT_API = 'https://beadbackend.onrender.com';

function trimSlash(value) {
  return String(value || '').trim().replace(/\/$/, '');
}

function publicApiOrigin(req) {
  const envUrl = trimSlash(process.env.API_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL);
  if (envUrl && !/localhost|127\.0\.0\.1/i.test(envUrl)) return envUrl;
  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') return DEFAULT_API;
  if (req) {
    const host = req.headers['x-forwarded-host'] || req.get?.('host');
    if (host && !/localhost|127\.0\.0\.1/i.test(host)) {
      const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
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
