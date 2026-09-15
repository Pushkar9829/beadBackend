const express = require('express');
const ctrl = require('../controllers/customizerController');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/purposes', ctrl.purposes);
router.get('/purposes/:purposeId/intentions', ctrl.intentions);
router.get('/intentions/:intentionId/beads', ctrl.recommendedBeads);
router.get('/charms', ctrl.charms);
router.get('/config', ctrl.config);
router.get('/beads', ctrl.beads);
router.get('/layers', ctrl.studioModes);
router.get('/layers/:kind', ctrl.studioLayerList);
router.get('/layers/:kind/:slug', ctrl.studioLayerItem);
router.post('/calibrate', ctrl.calibrate);
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

router.get('/admin/mulank', requireAuth, requireAdmin, ctrl.adminMulank);
router.post('/admin/mulank', requireAuth, requireAdmin, ctrl.adminSaveMulank);
router.put('/admin/mulank/:id', requireAuth, requireAdmin, ctrl.adminSaveMulank);
router.delete('/admin/mulank/:id', requireAuth, requireAdmin, ctrl.adminDeleteMulank);

router.get('/admin/zodiac', requireAuth, requireAdmin, ctrl.adminZodiac);
router.post('/admin/zodiac', requireAuth, requireAdmin, ctrl.adminSaveZodiac);
router.put('/admin/zodiac/:id', requireAuth, requireAdmin, ctrl.adminSaveZodiac);
router.delete('/admin/zodiac/:id', requireAuth, requireAdmin, ctrl.adminDeleteZodiac);

router.get('/admin/charms', requireAuth, requireAdmin, ctrl.adminCharms);
router.post('/admin/charms', requireAuth, requireAdmin, ctrl.adminSaveCharm);
router.put('/admin/charms/:id', requireAuth, requireAdmin, ctrl.adminSaveCharm);
router.put('/admin/config', requireAuth, requireAdmin, ctrl.adminSaveConfig);

router.get('/admin/layers', requireAuth, requireAdmin, ctrl.adminLayers);
router.post('/admin/layers', requireAuth, requireAdmin, ctrl.adminSaveLayer);
router.post('/admin/layers/restore', requireAuth, requireAdmin, ctrl.adminRestoreLayers);
router.put('/admin/layers/:id', requireAuth, requireAdmin, ctrl.adminSaveLayer);
router.delete('/admin/layers/:id', requireAuth, requireAdmin, ctrl.adminDeleteLayer);

module.exports = router;
