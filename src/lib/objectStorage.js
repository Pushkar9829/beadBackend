const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Whitelist of accepted upload types. SVG (scriptable) and anything else is rejected.
const ALLOWED_TYPES = {
  'image/jpeg': { ext: '.jpg', kind: 'image' },
  'image/png': { ext: '.png', kind: 'image' },
  'image/webp': { ext: '.webp', kind: 'image' },
  'image/gif': { ext: '.gif', kind: 'image' },
  'image/avif': { ext: '.avif', kind: 'image' },
  'video/mp4': { ext: '.mp4', kind: 'video' },
  'video/webm': { ext: '.webm', kind: 'video' },
  'video/quicktime': { ext: '.mov', kind: 'video' },
};

const MIME_ALIASES = { 'image/jpg': 'image/jpeg', 'image/pjpeg': 'image/jpeg', 'image/x-png': 'image/png' };

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_VIDEO_BYTES = 40 * 1024 * 1024;

const MP4_BRANDS = new Set(['isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'M4V ', 'M4VP', 'dash', 'mmp4', 'MSNV', 'f4v ']);

function normalizeMime(mime) {
  const m = String(mime || '').toLowerCase().trim();
  return MIME_ALIASES[m] || m;
}

function ascii(buf, start, end) {
  return buf.subarray(start, end).toString('latin1');
}

/** Detects the real file type from magic bytes. Returns a whitelisted mime or null. */
function sniffMime(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (ascii(buf, 0, 4) === 'GIF8') return 'image/gif';
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 12) === 'WEBP') return 'image/webp';
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'video/webm';
  if (ascii(buf, 4, 8) === 'ftyp') {
    const boxSize = Math.min(buf.readUInt32BE(0) || 0, buf.length, 256);
    const major = ascii(buf, 8, 12);
    const brands = [major];
    for (let i = 16; i + 4 <= boxSize; i += 4) brands.push(ascii(buf, i, i + 4));
    if (brands.includes('avif') || brands.includes('avis')) return 'image/avif';
    if (major === 'qt  ') return 'video/quicktime';
    if (brands.some((b) => MP4_BRANDS.has(b))) return 'video/mp4';
    return null;
  }
  return null;
}

/**
 * Verifies an uploaded file: declared mime must be whitelisted, magic bytes must match it,
 * and the size must be within the per-kind cap. Returns { mime, ext, kind } or throws (status 400/413).
 */
function verifyUpload(file) {
  const fail = (message, status = 400) => {
    const err = new Error(message);
    err.status = status;
    return err;
  };
  if (!file || !file.buffer) throw fail('No file uploaded.');
  const declared = normalizeMime(file.mimetype);
  if (!ALLOWED_TYPES[declared]) throw fail('Only JPEG, PNG, WebP, GIF, AVIF images and MP4/WebM/MOV videos are allowed.');
  const detected = sniffMime(file.buffer);
  if (!detected) throw fail('The file contents do not match an allowed image or video type.');
  const isoPair = new Set(['video/mp4', 'video/quicktime']);
  if (detected !== declared && !(isoPair.has(detected) && isoPair.has(declared))) {
    throw fail('The file contents do not match its declared type.');
  }
  const info = ALLOWED_TYPES[detected];
  const size = file.size ?? file.buffer.length;
  if (info.kind === 'image' && size > MAX_IMAGE_BYTES) throw fail('Image is too large (max 15MB).', 413);
  if (info.kind === 'video' && size > MAX_VIDEO_BYTES) throw fail('Video is too large (max 40MB).', 413);
  return { mime: detected, ext: info.ext, kind: info.kind };
}

/** Strips path components / control chars from a client-supplied original filename (display only). */
function safeOriginalName(name) {
  const base = String(name || '').split(/[\\/]/).pop() || '';
  return base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').trim().slice(0, 200) || 'upload';
}

function bucket() {
  return (
    process.env.AWS_S3_BUCKET
    || process.env.AWS_S3_BUCKET_NAME
    || process.env.S3_BUCKET
    || ''
  );
}

function region() {
  return process.env.AWS_REGION || process.env.S3_REGION || 'ap-south-1';
}

function s3Enabled() {
  return Boolean(bucket());
}

let cachedClient;

function s3Client() {
  if (cachedClient) return cachedClient;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  cachedClient = new S3Client({
    region: region(),
    ...(accessKeyId && secretAccessKey
      ? { credentials: { accessKeyId, secretAccessKey } }
      : {}),
  });
  return cachedClient;
}

function objectKey(ext, folder = 'other') {
  const crypto = require('crypto');
  const safeFolder = String(folder || 'other').replace(/[^a-z0-9_-]/gi, '').toLowerCase().slice(0, 40) || 'other';
  const name = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
  return { key: `media/${safeFolder}/${name}`, filename: name };
}

function publicUrl(key) {
  const base = (
    process.env.S3_PUBLIC_BASE_URL
    || process.env.AWS_S3_PUBLIC_BASE_URL
    || process.env.CLOUDFRONT_DOMAIN
    || ''
  ).replace(/\/$/, '');
  if (base) return `${base}/${key}`;
  return `https://${bucket()}.s3.${region()}.amazonaws.com/${key}`;
}

async function putFile(file, { folder = 'other' } = {}) {
  if (!file) throw new Error('No file provided');
  const body = file.buffer;
  if (!body) throw new Error('Upload buffer missing');
  // Extension and Content-Type come only from the verified (magic-byte) type, never the client.
  const verified = file.verifiedType || verifyUpload(file);
  const { key, filename } = objectKey(verified.ext, folder);

  if (s3Enabled()) {
    const params = {
      Bucket: bucket(),
      Key: key,
      Body: body,
      ContentType: verified.mime,
      ContentDisposition: 'inline',
      CacheControl: 'public, max-age=31536000, immutable',
    };
    if (process.env.S3_ACL) params.ACL = process.env.S3_ACL;
    await s3Client().send(new PutObjectCommand(params));
    return { storage: 's3', key, filename, url: publicUrl(key), mimeType: verified.mime, size: body.length };
  }

  const dest = path.join(uploadDir, filename);
  fs.writeFileSync(dest, body);
  return { storage: 'local', key: filename, filename, url: `/uploads/${filename}`, mimeType: verified.mime, size: body.length };
}

const MIME_BY_EXT = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

/** Stable-key upload for seed / catalog assets (overwrites the same object on re-seed). */
async function putLocalFile(absPath, { folder = 'other', filename } = {}) {
  if (!absPath || !fs.existsSync(absPath)) {
    throw new Error(`Seed media missing: ${absPath || '(empty path)'}`);
  }
  const name = filename || path.basename(absPath);
  const safeFolder = String(folder || 'other').replace(/[^a-z0-9_-]/gi, '').toLowerCase() || 'other';
  const key = `media/${safeFolder}/${name}`;
  const ext = path.extname(name).toLowerCase();
  const contentType = MIME_BY_EXT[ext] || 'application/octet-stream';
  const body = fs.readFileSync(absPath);

  if (s3Enabled()) {
    const params = {
      Bucket: bucket(),
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    };
    if (process.env.S3_ACL) params.ACL = process.env.S3_ACL;
    await s3Client().send(new PutObjectCommand(params));
    return { storage: 's3', key, filename: name, url: publicUrl(key), size: body.length, mimeType: contentType };
  }

  const dest = path.join(uploadDir, name);
  fs.writeFileSync(dest, body);
  return {
    storage: 'local',
    key: name,
    filename: name,
    url: `/uploads/${name}`,
    size: body.length,
    mimeType: contentType,
  };
}

async function deleteStored({ storage, key, filename, url } = {}) {
  try {
    if (storage === 's3' || (key && String(key).startsWith('media/'))) {
      if (!s3Enabled() || !key) return;
      await s3Client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
      return;
    }
    const localName = path.basename(String(filename || (url && String(url).startsWith('/uploads/') ? url : '')));
    if (!localName || localName === '.' || localName === '..') return;
    const dest = path.join(uploadDir, localName);
    if (fs.existsSync(dest)) fs.unlinkSync(dest);
  } catch (err) {
    console.warn('objectStorage.deleteStored', err.message);
  }
}

module.exports = {
  s3Enabled,
  putFile,
  putLocalFile,
  deleteStored,
  uploadDir,
  publicUrl,
  bucket,
  verifyUpload,
  sniffMime,
  safeOriginalName,
  ALLOWED_TYPES,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
};
