require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { connectDb } = require('../config/db');
const { putLocalFile, s3Enabled, publicUrl, bucket } = require('../lib/objectStorage');
const Bead = require('../models/Bead');
const Product = require('../models/Product');
const Banner = require('../models/Banner');
const BlogPost = require('../models/BlogPost');
const Media = require('../models/Media');
const Purpose = require('../models/Purpose');
const Intention = require('../models/Intention');
const SiteContent = require('../models/SiteContent');
const StoreSettings = require('../models/StoreSettings');
const Collection = require('../models/Collection');
const Category = require('../models/Category');
const Charm = require('../models/Charm');
const { HOME_DEFAULTS, mergeHomeContent } = require('../data/homeContent');

const FRONTEND_ROOT = path.resolve(__dirname, '../../../frontend');
const CATALOG_ROOT = path.join(FRONTEND_ROOT, 'public', 'catalog');
const ASSETS_ROOT = path.join(FRONTEND_ROOT, 'src', 'assets');

const PURPOSE_ASSETS = [
  { match: /love|relation/i, file: 'love-3d.png', icon: '🩷' },
  { match: /money|abund/i, file: 'purpose-money.png', icon: '💎' },
  { match: /career|success/i, file: 'purpose-career.png', icon: '👑' },
  { match: /confidence|power/i, file: 'purpose-confidence.png', icon: '🔥' },
  { match: /protect|ground/i, file: 'purpose-protection.png', icon: '🛡️' },
  { match: /focus|clarit/i, file: 'purpose-focus.png', icon: '🔮' },
  { match: /calm|emotion/i, file: 'purpose-calm.png', icon: '🪷' },
  { match: /sleep|relax/i, file: 'purpose-sleep.png', icon: '🌙' },
  { match: /energy|vital/i, file: 'purpose-energy.png', icon: '☀️' },
  { match: /spirit/i, file: 'purpose-spirit.png', icon: '✨' },
  { match: /begin/i, file: 'purpose-beginnings.png', icon: '🌱' },
  { match: /communicat|express/i, file: 'purpose-communication.png', icon: '💬' },
  { match: /balance/i, file: 'purpose-balance.png', icon: '⚖️' },
];

const HOME_ASSETS = [
  { local: path.join(ASSETS_ROOT, 'home', 'hero-bracelet.jpg'), folder: 'banner', keys: ['hero.image', 'studio.bannerImage'] },
  { local: path.join(ASSETS_ROOT, 'home', 'finale-banner.jpg'), folder: 'banner', keys: ['finale.image'] },
  { local: path.join(ASSETS_ROOT, 'home', 'footer-banner.jpg'), folder: 'banner', keys: ['footer.bannerImage'] },
  { local: path.join(ASSETS_ROOT, 'home', 'house-crystals.jpg'), folder: 'banner', houseSlug: 'crystals' },
  { local: path.join(ASSETS_ROOT, 'home', 'house-rudraksha.jpg'), folder: 'banner', houseSlug: 'rudraksha' },
  { local: path.join(ASSETS_ROOT, 'home', 'house-gemstones.jpg'), folder: 'banner', houseSlug: 'gemstones' },
  { local: path.join(ASSETS_ROOT, 'brand', 'logo.jpg'), folder: 'logo', keys: ['brand.logo', 'footer.logo'] },
];

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => /\.(jpe?g|png|webp|gif|svg|avif)$/i.test(name));
}

function setByPath(obj, dotted, value) {
  const parts = dotted.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    if (!cur[key] || typeof cur[key] !== 'object') cur[key] = {};
    cur = cur[key];
  }
  cur[parts[parts.length - 1]] = value;
}

function rewriteLocalUrl(value, urlMap) {
  if (!value || typeof value !== 'string') return value;
  if (value.startsWith('http://') || value.startsWith('https://')) return value;
  if (urlMap[value]) return urlMap[value];
  const normalized = value.startsWith('/') ? value : `/${value}`;
  return urlMap[normalized] || value;
}

async function uploadFile(absPath, folder, cache) {
  const abs = path.resolve(absPath);
  if (cache.has(abs)) return cache.get(abs);
  const uploaded = await putLocalFile(abs, { folder, filename: path.basename(abs) });
  cache.set(abs, uploaded);
  console.log(`  ${uploaded.storage}: ${folder}/${uploaded.filename} → ${uploaded.url}`);
  return uploaded;
}

/**
 * Upload catalog + purpose + home assets to S3 (or local /uploads), then rewrite DB image fields.
 */
async function uploadSeedMedia() {
  if (!s3Enabled()) {
    console.warn('S3 is not configured (set AWS_S3_BUCKET_NAME). Seed media will use local /uploads URLs.');
  } else {
    console.log(`Uploading seed media to s3://${bucket()}…`);
  }

  const cache = new Map();
  const urlMap = {};
  const mediaRows = [];

  async function mapCatalog(relWebPath, absPath, folder) {
    const uploaded = await uploadFile(absPath, folder, cache);
    urlMap[relWebPath] = uploaded.url;
    urlMap[relWebPath.replace(/^\//, '')] = uploaded.url;
    mediaRows.push({
      filename: uploaded.filename,
      originalName: uploaded.filename,
      url: uploaded.url,
      key: uploaded.key,
      storage: uploaded.storage,
      mimeType: uploaded.mimeType,
      size: uploaded.size,
      folder,
      tags: ['seed'],
    });
    return uploaded;
  }

  for (const name of listFiles(path.join(CATALOG_ROOT, 'beads'))) {
    await mapCatalog(
      `/catalog/beads/${name}`,
      path.join(CATALOG_ROOT, 'beads', name),
      'bead',
    );
  }
  for (const name of listFiles(path.join(CATALOG_ROOT, 'products'))) {
    await mapCatalog(
      `/catalog/products/${name}`,
      path.join(CATALOG_ROOT, 'products', name),
      'product',
    );
  }

  const purposeUrlByFile = {};
  for (const name of listFiles(path.join(ASSETS_ROOT, 'purposes'))) {
    const uploaded = await mapCatalog(
      `/assets/purposes/${name}`,
      path.join(ASSETS_ROOT, 'purposes', name),
      'purpose',
    );
    purposeUrlByFile[name] = uploaded.url;
  }

  const homeUploads = {};
  for (const row of HOME_ASSETS) {
    if (!fs.existsSync(row.local)) {
      console.warn(`  skip missing ${row.local}`);
      continue;
    }
    const uploaded = await uploadFile(row.local, row.folder, cache);
    homeUploads[row.local] = uploaded;
    mediaRows.push({
      filename: uploaded.filename,
      originalName: uploaded.filename,
      url: uploaded.url,
      key: uploaded.key,
      storage: uploaded.storage,
      mimeType: uploaded.mimeType,
      size: uploaded.size,
      folder: row.folder,
      tags: ['seed', 'home'],
    });
  }

  // --- rewrite DB documents ---
  const beads = await Bead.find();
  for (const bead of beads) {
    const next = rewriteLocalUrl(bead.image, urlMap);
    if (next !== bead.image) {
      bead.image = next;
      bead.textureUrl = next;
      await bead.save();
    }
  }

  const products = await Product.find();
  for (const product of products) {
    const images = (product.images || []).map((img) => rewriteLocalUrl(img, urlMap));
    if (images.join('|') !== (product.images || []).join('|')) {
      product.images = images;
      await product.save();
    }
  }

  for (const Model of [Banner, BlogPost, Collection, Category, Charm]) {
    const rows = await Model.find();
    for (const row of rows) {
      let dirty = false;
      if (row.image) {
        const next = rewriteLocalUrl(row.image, urlMap);
        if (next !== row.image) {
          row.image = next;
          dirty = true;
        }
      }
      if (row.mobileImage) {
        const next = rewriteLocalUrl(row.mobileImage, urlMap);
        if (next !== row.mobileImage) {
          row.mobileImage = next;
          dirty = true;
        }
      }
      if (dirty) await row.save();
    }
  }

  const mediaDocs = await Media.find();
  for (const row of mediaDocs) {
    const next = rewriteLocalUrl(row.url, urlMap);
    if (next !== row.url) {
      row.url = next;
      const match = mediaRows.find((m) => m.url === next);
      if (match) {
        row.key = match.key;
        row.storage = match.storage;
        row.mimeType = match.mimeType || row.mimeType;
        row.size = match.size || row.size;
      }
      await row.save();
    }
  }

  // Seed Media library entries for newly uploaded files that are not already listed.
  const existingUrls = new Set((await Media.find().select('url').lean()).map((m) => m.url));
  const fresh = mediaRows.filter((m) => m.url && !existingUrls.has(m.url));
  if (fresh.length) await Media.insertMany(fresh);

  const purposes = await Purpose.find();
  for (const purpose of purposes) {
    const hay = `${purpose.slug || ''} ${purpose.name || ''}`;
    const found = PURPOSE_ASSETS.find((row) => row.match.test(hay));
    if (!found) continue;
    const imageUrl = purposeUrlByFile[found.file];
    if (imageUrl) purpose.image = imageUrl;
    if (found.icon) purpose.icon = found.icon;
    await purpose.save();
  }

  // Intentions inherit purpose artwork when empty.
  const purposeById = new Map(purposes.map((p) => [String(p._id), p]));
  const intentions = await Intention.find();
  for (const intention of intentions) {
    const parent = purposeById.get(String(intention.purposeId));
    if (!parent) continue;
    let dirty = false;
    if (!intention.image && parent.image) {
      intention.image = parent.image;
      dirty = true;
    }
    if (!intention.icon && parent.icon) {
      intention.icon = parent.icon;
      dirty = true;
    }
    if (dirty) await intention.save();
  }

  let site = await SiteContent.findOne({ key: 'main' });
  if (!site) {
    site = await SiteContent.create({ key: 'main', ...HOME_DEFAULTS });
  }
  const content = mergeHomeContent(site.toObject ? site.toObject() : site);

  for (const row of HOME_ASSETS) {
    const uploaded = homeUploads[row.local];
    if (!uploaded) continue;
    if (row.houseSlug) {
      const items = content.houses?.items || [];
      const idx = items.findIndex((h) => h.slug === row.houseSlug);
      if (idx >= 0) items[idx].image = uploaded.url;
      continue;
    }
    (row.keys || []).forEach((key) => setByPath(content, key, uploaded.url));
  }

  // Testimonials that still point at /catalog get rewritten.
  content.testimonials = (content.testimonials || []).map((t) => ({
    ...t,
    media: rewriteLocalUrl(t.media, urlMap),
  }));

  await SiteContent.findOneAndUpdate(
    { key: 'main' },
    { $set: { ...content, key: 'main' } },
    { upsert: true },
  );

  const settings = await StoreSettings.findOne({ key: 'store' });
  if (settings) {
    const logoUpload = homeUploads[path.join(ASSETS_ROOT, 'brand', 'logo.jpg')];
    if (logoUpload) {
      settings.logo = logoUpload.url;
      if (settings.seo) settings.seo.ogImage = logoUpload.url;
      await settings.save();
    }
  }

  return {
    storage: s3Enabled() ? 's3' : 'local',
    uploaded: cache.size,
    catalogMapped: Object.keys(urlMap).filter((k) => k.startsWith('/catalog')).length,
    purposes: purposes.length,
  };
}

module.exports = { uploadSeedMedia, FRONTEND_ROOT, CATALOG_ROOT };

if (require.main === module) {
  (async () => {
    await connectDb();
    const result = await uploadSeedMedia();
    console.log('Seed media upload complete.', result);
    if (s3Enabled()) console.log(`Public base: ${publicUrl('').replace(/\/$/, '')}`);
    process.exit(0);
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
