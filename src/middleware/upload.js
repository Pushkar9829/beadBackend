const multer = require('multer');

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 40 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype.startsWith('image/')
      || file.mimetype === 'video/mp4'
      || file.mimetype === 'video/webm'
      || file.mimetype === 'video/quicktime';
    if (!ok) return cb(new Error('Only images and mp4/webm/mov videos are allowed.'));
    cb(null, true);
  },
});

function uploadSingle(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      err.status = 413;
      err.message = 'File is too large (max 40MB).';
    } else {
      err.status = 400;
    }
    next(err);
  });
}

module.exports = { upload, uploadSingle };
