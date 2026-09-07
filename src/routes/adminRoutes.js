const express = require('express');
const ctrl = require('../controllers/adminController');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { upload } = require('../middleware/upload');

const router = express.Router();

router.use(requireAuth, requireAdmin);
router.get('/dashboard', ctrl.dashboard);
router.get('/users', ctrl.users);
router.put('/users/:id', ctrl.updateUser);
router.get('/content', ctrl.content);
router.put('/content', ctrl.saveContent);
router.get('/media', ctrl.listMedia);
router.post('/media', upload.single('file'), ctrl.uploadMedia);

module.exports = router;
