require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const morgan = require('morgan');
const { connectDb } = require('./config/db');
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
const kundliRoutes = require('./routes/kundliRoutes');

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
  if (url.includes('/payments/cashfree/webhook') || url.includes('/shipping/ithink/webhook') || url.includes('/whatsapp/webhook')) {
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
// Global per-IP limit. Signed-in staff are not counted: an admin checking banner/content changes refreshes
// often, and a blocked admin loses uploads and saves (customers on shared Jio/Airtel IPs share the limit).
// The staff check only verifies the token signature + role (no DB); every admin route still runs full auth.
// Sign-in, OTP, sign-up and order routes keep their own stricter limits.
const STAFF_TOKEN_ROLES = new Set(['admin', 'manager', 'staff']);
function isStaffToken(req) {
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : req.cookies?.token;
  if (!token) return false;
  try {
    const claims = require('jsonwebtoken').verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    return STAFF_TOKEN_ROLES.has(claims?.role);
  } catch {
    return false;
  }
}
app.use('/api', rateLimit({ windowMs: 60 * 1000, max: Number(process.env.API_RATE_LIMIT_PER_MIN) || 300, skip: isStaffToken }));
app.use(csrfGuard);
app.use(optionalAuth);

app.get('/api/health', (_req, res) => res.json({ ok: true, brand: 'Kuberstones' }));
app.get('/api/content', contentController.get);
app.use('/api', storeRoutes);
app.use('/api/auth', authRoutes);
// Meta WhatsApp webhook: subscription check (GET) and signature-checked delivery receipts (POST).
{
  const whatsapp = require('./controllers/whatsappAuthController');
  app.get('/api/whatsapp/webhook', whatsapp.webhookVerify);
  app.post('/api/whatsapp/webhook', whatsapp.webhook);
}
app.use('/api/categories', categoryRoutes);
app.use('/api/products', productRoutes);
app.use('/api/customizer', customizerRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/shipping', shippingRoutes);
app.use('/api/kundli', kundliRoutes);
app.use('/api/admin', adminRoutes);

app.use(notFound);
app.use(errorHandler);

const port = process.env.PORT || 5000;

connectDb()
  .then(async () => {
    // Catalog, purposes, intentions, beads, layers, collections and FAQs are not written on boot.
    // Live records stay as they are. Run a seed script by hand only when you mean to change them.
    try {
      await require('./models/User').migrateEmailIndex();
    } catch (err) {
      console.warn('User index migration:', err.message);
    }

    const { expireStalePendingOrders } = require('./services/orderExpiryService');
    const runExpiry = () =>
      expireStalePendingOrders()
        .then((r) => r.cancelled && console.log(`Expired ${r.cancelled} unpaid order(s).`))
        .catch((err) => console.warn('Order expiry:', err.message));
    setInterval(runExpiry, 10 * 60 * 1000).unref();
    runExpiry();
    // Free Kundli: fixes the launch cutoff on first start and re-runs generations that died mid-way.
    try {
      await require('./services/kundliService').startKundliJobs();
    } catch (err) {
      console.warn('Kundli jobs:', err.message);
    }

    const server = app.listen(port, () => {
      const { s3Enabled } = require('./lib/objectStorage');
      console.log(`Kuberstones API on http://localhost:${port}`);
      console.log(s3Enabled() ? 'Media uploads: Amazon S3' : 'Media uploads: local /uploads (set AWS_S3_BUCKET to use S3)');
    });
    // Large media uploads can take several minutes on a slow connection. Node's default request
    // timeout (5 min) cuts them off. The nginx in front of this process must allow the same body size.
    server.requestTimeout = 15 * 60 * 1000;
    server.headersTimeout = 15 * 60 * 1000 + 5000;
    server.timeout = 0;
  })
  .catch((err) => {
    console.error('Failed to start', err);
    process.exit(1);
  });
