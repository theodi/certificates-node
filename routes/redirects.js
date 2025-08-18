import express from 'express';

const router = express.Router();

// Legacy locale-prefixed certificate routes → canonical /datasets paths
router.get('/:locale/datasets/:datasetId/certificates', (req, res) => {
  res.redirect(301, `/datasets/${req.params.datasetId}/certificates`);
});

router.get('/:locale/datasets/:datasetId/certificates/:responseSetId', (req, res) => {
  res.redirect(301, `/datasets/${req.params.datasetId}/certificates/${req.params.responseSetId}`);
});

router.get('/:locale/datasets/:datasetId/certificate', (req, res) => {
  res.redirect(301, `/datasets/${req.params.datasetId}/certificate`);
});
router.get('/:locale/datasets/:datasetId/certificate/embed', (req, res) => {
  res.redirect(301, `/datasets/${req.params.datasetId}/certificate/embed`);
});
router.get('/:locale/datasets/:datasetId/certificate/badge.png', (req, res) => {
  res.redirect(301, `/datasets/${req.params.datasetId}/certificate/badge.png`);
});
router.get('/:locale/datasets/:datasetId/certificate/badge.js', (req, res) => {
  res.redirect(301, `/datasets/${req.params.datasetId}/certificate/badge.js`);
}); 
router.get('/:locale/datasets/', (req, res) => {
  res.redirect(301, `/datasets/`);
});

export default router;


