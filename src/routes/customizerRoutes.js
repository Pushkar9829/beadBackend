const express = require('express');
const ctrl = require('../controllers/customizerController');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/purposes', ctrl.purposes);
router.get('/purposes/:purposeId/intentions', ctrl.intentions);
router.get('/intentions/:intentionId/beads', ctrl.recommendedBeads);
router.get('/charms', ctrl.charms);
router.get('/config', ctrl.config);
router.post('/quote', ctrl.quote);

router.get('/admin/purposes', requireAuth, requireAdmin, ctrl.adminPurposes);
router.post('/admin/purposes', requireAuth, requireAdmin, ctrl.adminSavePurpose);
router.put('/admin/purposes/:id', requireAuth, requireAdmin, ctrl.adminSavePurpose);
router.delete('/admin/purposes/:id', requireAuth, requireAdmin, ctrl.adminDeletePurpose);

router.get('/admin/intentions', requireAuth, requireAdmin, ctrl.adminIntentions);
router.post('/admin/intentions', requireAuth, requireAdmin, ctrl.adminSaveIntention);
router.put('/admin/intentions/:id', requireAuth, requireAdmin, ctrl.adminSaveIntention);
router.delete('/admin/intentions/:id', requireAuth, requireAdmin, ctrl.adminDeleteIntention);

router.get('/admin/beads', requireAuth, requireAdmin, ctrl.adminBeads);
router.post('/admin/beads', requireAuth, requireAdmin, ctrl.adminSaveBead);
router.put('/admin/beads/:id', requireAuth, requireAdmin, ctrl.adminSaveBead);
router.delete('/admin/beads/:id', requireAuth, requireAdmin, ctrl.adminDeleteBead);

router.get('/admin/mappings', requireAuth, requireAdmin, ctrl.adminMappings);
router.post('/admin/mappings', requireAuth, requireAdmin, ctrl.adminSaveMapping);
router.put('/admin/mappings/:id', requireAuth, requireAdmin, ctrl.adminSaveMapping);
router.delete('/admin/mappings/:id', requireAuth, requireAdmin, ctrl.adminDeleteMapping);

router.get('/admin/charms', requireAuth, requireAdmin, ctrl.adminCharms);
router.post('/admin/charms', requireAuth, requireAdmin, ctrl.adminSaveCharm);
router.put('/admin/charms/:id', requireAuth, requireAdmin, ctrl.adminSaveCharm);
router.put('/admin/config', requireAuth, requireAdmin, ctrl.adminSaveConfig);

module.exports = router;
