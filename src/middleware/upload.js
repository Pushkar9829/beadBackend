const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { ALLOWED_TYPES, MAX_IMAGE_MB, MAX_VIDEO_MB, MAX_VIDEO_BYTES, verifyUpload, safeOriginalName } = require('../lib/objectStorage');

// Disk, not memory: a multi-megabyte upload on a small EC2 instance otherwise sits entirely in the Node heap.
const tmpDir = path.join(os.tmpdir(), 'kuberstones-uploads');
const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    fs.mkdirSync(tmpDir, { recursive: true });
    cb(null, tmpDir);
  },
  filename(_req, _file, cb) {
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`);
  },
});

const DECLARED_OK = new Set([...Object.keys(ALLOWED_TYPES), 'image/jpg', 'image/pjpeg', 'image/x-png']);

const upload = multer({
  storage,
  // Hard ceiling (video max). Images are further capped after type verification.
  limits: { fileSize: MAX_VIDEO_BYTES, files: 1, fields: 20 },
  fileFilter: (_req, file, cb) => {
    const ok = DECLARED_OK.has(String(file.mimetype || '').toLowerCase());
    if (!ok) {
      const err = new Error('Only JPEG, PNG, WebP, GIF, AVIF images and MP4/WebM/MOV videos are allowed.');
      err.status = 400;
      return cb(err);
    }
    cb(null, true);
  },
});

function discardUpload(req) {
  const filePath = req.file?.path;
  if (!filePath) return;
  fs.unlink(filePath, () => {});
}

function uploadSingle(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err) {
      discardUpload(req);
      if (err.code === 'LIMIT_FILE_SIZE') {
        err.status = 413;
        err.message = `File is too large (max ${MAX_IMAGE_MB}MB for images, ${MAX_VIDEO_MB}MB for videos).`;
      } else {
        err.status = err.status || 400;
      }
      return next(err);
    }
    if (!req.file) return next();
    try {
      // Verify magic bytes against the declared type; the verified type drives extension + Content-Type.
      const verified = verifyUpload(req.file);
      req.file.verifiedType = verified;
      req.file.mimetype = verified.mime;
      req.file.originalname = safeOriginalName(req.file.originalname);
      let cleaned = false;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        discardUpload(req);
      };
      res.on('finish', cleanup);
      res.on('close', cleanup);
      return next();
    } catch (verifyErr) {
      discardUpload(req);
      req.file = undefined;
      return next(verifyErr);
    }
  });
}

module.exports = { upload, uploadSingle };
