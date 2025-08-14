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

router.get('/:locale/datasets/', (req, res) => {
  res.redirect(301, `/datasets/`);
});

export default router;


