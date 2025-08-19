import express from 'express';

const router = express.Router();

router.get('/:locale/datasets.feed', (req, res) => {
  res.redirect(301, `/datasets.feed`);
});
router.get('/:locale/datasets.html', (req, res) => {
  res.redirect(301, `/datasets.html`);
});
router.get('/:locale/datasets.rss', (req, res) => {
  res.redirect(301, `/datasets.rss`);
});
router.get('/:locale/datasets.xml', (req, res) => {
  res.redirect(301, `/datasets.xml`);
});

router.get('/:locale/datasets/:datasetId.feed', (req, res) => {
  res.redirect(301, `/datasets/${req.params.datasetId}.feed`);
});
router.get('/:locale/datasets/:datasetId.html', (req, res) => {
  res.redirect(301, `/datasets/${req.params.datasetId}.html`);
});
router.get('/:locale/datasets/:datasetId.rss', (req, res) => {
  res.redirect(301, `/datasets/${req.params.datasetId}.rss`);
});
router.get('/:locale/datasets/:datasetId.xml', (req, res) => {
  res.redirect(301, `/datasets/${req.params.datasetId}.xml`);
});

// Legacy locale-prefixed certificate routes → canonical /datasets paths
router.get('/:locale/datasets/:datasetId/certificates', (req, res) => {
  res.redirect(301, `/datasets/${req.params.datasetId}/certificates`);
});

router.get('/:locale/datasets/:datasetId/certificates/:certificateId', (req, res) => {
  res.redirect(301, `/datasets/${req.params.datasetId}/certificates/${req.params.certificateId}`);
});
router.get('/:locale/datasets/:datasetId/certificates/:certificateId.json', (req, res) => {
  res.redirect(301, `/datasets/${req.params.datasetId}/certificates/${req.params.certificateId}.json`);
});
router.get('/:locale/datasets/:datasetId/certificate.json', (req, res) => {
  res.redirect(301, `/datasets/${req.params.datasetId}/certificate.json`);
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


