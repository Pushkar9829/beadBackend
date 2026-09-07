const express = require('express');
const ctrl = require('../controllers/categoryController');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/', ctrl.listPublic);
router.get('/admin/all', requireAuth, requireAdmin, ctrl.adminList);
router.post('/admin', requireAuth, requireAdmin, ctrl.adminCreate);
router.put('/admin/:id', requireAuth, requireAdmin, ctrl.adminUpdate);
router.delete('/admin/:id', requireAuth, requireAdmin, ctrl.adminRemove);
router.get('/:slug', ctrl.getBySlug);

module.exports = router;
