const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
  'image/avif': '.avif',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
};

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

function fileExt(file) {
  const fromName = path.extname(file.originalname || '').toLowerCase();
  if (fromName && fromName.length <= 10) return fromName;
  return EXT_BY_MIME[file.mimetype] || '.bin';
}

function objectKey(file, folder = 'other') {
  const safeFolder = String(folder || 'other').replace(/[^a-z0-9_-]/gi, '').toLowerCase() || 'other';
  const name = `${Date.now()}-${Math.round(Math.random() * 1e9)}${fileExt(file)}`;
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
  const { key, filename } = objectKey(file, folder);
  const body = file.buffer;
  if (!body) throw new Error('Upload buffer missing');

  if (s3Enabled()) {
    const params = {
      Bucket: bucket(),
      Key: key,
      Body: body,
      ContentType: file.mimetype || 'application/octet-stream',
      CacheControl: 'public, max-age=31536000, immutable',
    };
    if (process.env.S3_ACL) params.ACL = process.env.S3_ACL;
    await s3Client().send(new PutObjectCommand(params));
    return { storage: 's3', key, filename, url: publicUrl(key) };
  }

  const dest = path.join(uploadDir, filename);
  fs.writeFileSync(dest, body);
  return { storage: 'local', key: filename, filename, url: `/uploads/${filename}` };
}

async function deleteStored({ storage, key, filename, url } = {}) {
  try {
    if (storage === 's3' || (key && String(key).startsWith('media/'))) {
      if (!s3Enabled() || !key) return;
      await s3Client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
      return;
    }
    const localName = filename || (url && String(url).startsWith('/uploads/') ? path.basename(url) : '');
    if (!localName) return;
    const dest = path.join(uploadDir, localName);
    if (fs.existsSync(dest)) fs.unlinkSync(dest);
  } catch (err) {
    console.warn('objectStorage.deleteStored', err.message);
  }
}

module.exports = { s3Enabled, putFile, deleteStored, uploadDir };
