const multer = require('multer');
const { ALLOWED_TYPES, MAX_VIDEO_BYTES, verifyUpload, safeOriginalName } = require('../lib/objectStorage');

const storage = multer.memoryStorage();

const DECLARED_OK = new Set([...Object.keys(ALLOWED_TYPES), 'image/jpg', 'image/pjpeg', 'image/x-png']);

const upload = multer({
  storage,
  // Hard ceiling (video max). Images are further capped at 15MB after type verification.
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

function uploadSingle(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        err.status = 413;
        err.message = 'File is too large (max 15MB for images, 40MB for videos).';
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
      return next();
    } catch (verifyErr) {
      req.file = undefined;
      return next(verifyErr);
    }
  });
}

module.exports = { upload, uploadSingle };
