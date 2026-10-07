require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const morgan = require('morgan');
const { connectDb } = require('./config/db');
const { ensureLayerBeads } = require('./seed/ensureLayerBeads');
const { ensureAuthAccounts } = require('./seed/ensureAuthAccounts');
const { ensureStudioLayers } = require('./seed/ensureStudioLayers');
const { ensurePurposeCatalog } = require('./seed/ensurePurposeCatalog');
const { notFound, errorHandler } = require('./middleware/error');
const { optionalAuth, jwtSecret } = require('./middleware/auth');
const { rateLimit } = require('./middleware/rateLimit');
const contentController = require('./controllers/contentController');

const authRoutes = require('./routes/authRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const productRoutes = require('./routes/productRoutes');
const customizerRoutes = require('./routes/customizerRoutes');
const cartRoutes = require('./routes/cartRoutes');
const orderRoutes = require('./routes/orderRoutes');
const adminRoutes = require('./routes/adminRoutes');
const storeRoutes = require('./routes/storeRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const shippingRoutes = require('./routes/shippingRoutes');

jwtSecret(); // fail fast on a missing/weak JWT_SECRET

const isProd = process.env.NODE_ENV === 'production';
const app = express();

app.disable('x-powered-by');
// Render / Vercel sit behind one proxy hop; needed for correct req.ip (rate limits) and secure cookies.
const proxyHops = Number.parseInt(process.env.TRUST_PROXY_HOPS ?? '1', 10);
app.set('trust proxy', Number.isInteger(proxyHops) && proxyHops >= 0 ? proxyHops : 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
const DEFAULT_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:4173',
  'https://beads-front-end.vercel.app',
];

const extraOrigins = String(process.env.CLIENT_ORIGIN || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const allowedOrigins = [...new Set([...DEFAULT_ORIGINS, ...extraOrigins])];

function originAllowed(origin) {
  if (!origin) return false;
  if (allowedOrigins.includes(origin)) return true;
  if (isProd) return false;
  try {
    const { hostname } = new URL(origin);
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

app.use(
  cors({
    origin(origin, cb) {
      // No Origin header = same-origin, curl, or server-to-server (webhooks): no CORS headers needed.
      cb(null, !origin || originAllowed(origin));
    },
    credentials: true,
  })
);

// CSRF guard: the auth cookie is SameSite=None in production, so a state-changing request that
// authenticates with the cookie (rather than a Bearer header) must come from an allowed origin.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
function csrfGuard(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  // A browser always sends Origin on cross-site POSTs: reject foreign ones outright (covers login CSRF too).
  if (req.headers.origin && !originAllowed(req.headers.origin)) {
    return res.status(403).json({ message: 'Request blocked: untrusted origin.' });
  }
  if (String(req.headers.authorization || '').startsWith('Bearer ')) return next();
  if (!req.headers.cookie || !/(?:^|;\s*)token=/.test(req.headers.cookie)) return next();
  let source = req.headers.origin;
  if (!source && req.headers.referer) {
    try {
      source = new URL(req.headers.referer).origin;
    } catch {
      source = null;
    }
  }
  if (source && originAllowed(source)) return next();
  return res.status(403).json({ message: 'Request blocked: untrusted origin.' });
}

// Never log query strings: they can carry tokens.
morgan.token('path', (req) => (req.originalUrl || req.url || '').split('?')[0]);
app.use(morgan(isProd ? ':remote-addr :method :path :status :res[content-length] - :response-time ms' : ':method :path :status :response-time ms'));
function captureWebhookBody(req, _res, buf) {
  const url = req.originalUrl || req.url || '';
  if (url.includes('/payments/cashfree/webhook') || url.includes('/shipping/ithink/webhook')) {
    req.rawBody = buf.toString('utf8');
  }
}
// Form-encoded bodies are only accepted from payment/shipping providers, never from the browser app.
const webhookForm = express.urlencoded({ extended: false, limit: '1mb', verify: captureWebhookBody });
app.use('/api/payments/cashfree/webhook', webhookForm);
app.use('/api/shipping/ithink/webhook', webhookForm);
app.use(
  express.json({
    limit: '1mb',
    verify: captureWebhookBody,
  })
);
app.use(cookieParser());
app.use(
  '/uploads',
  express.static(path.join(__dirname, '../uploads'), {
    dotfiles: 'deny',
    index: false,
    setHeaders(res) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; sandbox");
    },
  })
);
app.use('/api', rateLimit({ windowMs: 60 * 1000, max: Number(process.env.API_RATE_LIMIT_PER_MIN) || 300 }));
app.use(csrfGuard);
app.use(optionalAuth);

app.get('/api/health', (_req, res) => res.json({ ok: true, brand: 'Kuberstones' }));
app.get('/api/content', contentController.get);
app.use('/api', storeRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/products', productRoutes);
app.use('/api/customizer', customizerRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/shipping', shippingRoutes);
app.use('/api/admin', adminRoutes);

app.use(notFound);
app.use(errorHandler);

const port = process.env.PORT || 5000;

connectDb()
  .then(async () => {
    // Each step is isolated so one failure doesn't skip the rest (e.g. studio layers have no request-time fallback).
    const step = async (label, fn) => {
      try {
        await fn();
      } catch (err) {
        console.warn(`Startup seeding (${label}):`, err.message);
      }
    };
    await step('auth accounts', async () => {
      const accounts = await ensureAuthAccounts();
      if (accounts.length) console.log(`Auth accounts added: ${accounts.join(', ')}`);
    });
    await step('catalog beads', async () => {
      const { created } = await require('./seed/ensureCatalogBeads').ensureCatalogBeads();
      if (created.length) console.log(`Catalog beads added: ${created.join(', ')}`);
    });
    await step('layer beads', async () => {
      const beads = await ensureLayerBeads();
      if (beads.created.length) console.log(`Layer beads added: ${beads.created.join(', ')}`);
      if (beads.priced?.length) console.log(`Catalog prices applied: ${beads.priced.join(', ')}`);
    });
    await step('purpose catalog', async () => {
      const catalog = await ensurePurposeCatalog();
      if (catalog?.intentions) console.log(`Purpose catalog: ${catalog.purposes} purposes, ${catalog.intentions} intentions.`);
    });
    await step('studio layers', async () => {
      const layers = await ensureStudioLayers();
      if (layers.created.length) console.log(`Studio layers synced: ${layers.created.length}`);
    });
    await step('collections', () => require('./services/collectionService').ensureDefaultCollections());
    await step('faqs', () => require('./controllers/platformController').ensureDefaultFaqs());

    const { expireStalePendingOrders } = require('./services/orderExpiryService');
    const runExpiry = () =>
      expireStalePendingOrders()
        .then((r) => r.cancelled && console.log(`Expired ${r.cancelled} unpaid order(s).`))
        .catch((err) => console.warn('Order expiry:', err.message));
    setInterval(runExpiry, 10 * 60 * 1000).unref();
    runExpiry();

    app.listen(port, () => {
      const { s3Enabled } = require('./lib/objectStorage');
      console.log(`Kuberstones API on http://localhost:${port}`);
      console.log(s3Enabled() ? 'Media uploads: Amazon S3' : 'Media uploads: local /uploads (set AWS_S3_BUCKET to use S3)');
    });
  })
  .catch((err) => {
    console.error('Failed to start', err);
    process.exit(1);
  });
