const express = require('express');
const ctrl = require('../controllers/orderController');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.post('/', requireAuth, ctrl.create);
router.get('/mine', requireAuth, ctrl.mine);
router.get('/admin/all', requireAuth, requireAdmin, ctrl.adminList);
router.put('/admin/:id', requireAuth, requireAdmin, ctrl.adminUpdate);
router.get('/:id', requireAuth, ctrl.getOne);

module.exports = router;
