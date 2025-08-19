import express from 'express';
import { ensureAuthenticated } from '../middleware/auth.js';
import { listPublicDatasetsPage, listPublicDatasetsData, listPublicDatasetsFeed, listMyDatasetsPage, listMyDatasetsData, newDatasetPage, createOrSelectDataset, chooseSurveyPage, createDraftCertificate, renderEditCertificatePage, deleteDataset, getCurrentUser } from '../controllers/datasets.js';
import { renderCertificate, listDatasetCertificatesPage, listDatasetCertificatesFeed, listDatasetCertificatesData, deleteCertificate, renderCertificateBadge, renderCertificateBadgeJs, getSingleCertificateId, getCertificateJson, publishCertificate, unpublishCertificate, saveResponsesPatch } from '../controllers/certificates.js';

const router = express.Router();

// Public list of datasets with published certificates (content negotiation)
router.get('/', (req, res, next) =>
  res.format({
    html: () => listPublicDatasetsPage(req, res, next),
    json: () => listPublicDatasetsData(req, res, next),
    'application/atom+xml': () => listPublicDatasetsFeed(req, res, next),
    'application/rss+xml': () => listPublicDatasetsFeed(req, res, next)
  })
);

// My datasets (require auth, content negotiation)
router.get('/my', ensureAuthenticated, (req, res, next) =>
  res.format({
    html: () => listMyDatasetsPage(req, res, next),
    json: () => listMyDatasetsData(req, res, next)
  })
);

// Create/select dataset and certificate flow
router.get('/new', ensureAuthenticated, newDatasetPage);
router.post('/new', ensureAuthenticated, createOrSelectDataset);
router.get('/:datasetId/new', ensureAuthenticated, chooseSurveyPage);
router.post('/:datasetId/new', ensureAuthenticated, createDraftCertificate);
router.get('/:datasetId/certificates/new', ensureAuthenticated, chooseSurveyPage);
router.post('/:datasetId/certificates/new', ensureAuthenticated, createDraftCertificate);
router.get('/:datasetId/certificates/:certificateId/edit', ensureAuthenticated, renderEditCertificatePage);

// Explicit JSON extension route must be BEFORE the generic param route to avoid shadowing
router.get('/:datasetId/certificates/:certificateId.json', (req, res, next) => {
  return getCertificateJson(req, res, next);
});

// Editor API/content negotiation on the same resource path
router.get('/:datasetId/certificates/:certificateId', (req, res, next) =>
  res.format({
    html: () => renderCertificate(req, res, next),
    json: () => getCertificateJson(req, res, next)
  })
);

router.get('/:datasetId/certificates/:certificateId/badge.png', (req, res, next) => {
  return renderCertificateBadge(req, res, next);
});
router.get('/:datasetId/certificates/:certificateId/badge.js', (req, res, next) => {
  return renderCertificateBadgeJs(req, res, next);
});
router.get('/:datasetId/certificates/:certificateId/embed', (req, res, next) => {
  req.embed = true;
  return renderCertificate(req, res, next);
});
router.patch('/:datasetId/certificates/:certificateId', ensureAuthenticated, saveResponsesPatch);
router.post('/:datasetId/certificates/:certificateId/publish', ensureAuthenticated, publishCertificate);
router.post('/:datasetId/certificates/:certificateId/unpublish', ensureAuthenticated, unpublishCertificate);

// Explicit JSON extension route for certificates list
router.get('/:datasetId/certificates.json', (req, res, next) => {
  return listDatasetCertificatesData(req, res, next);
});

// Drill-down: certificates for a dataset (public: published; logged-in: owner/admin rules) with content negotiation
router.get('/:datasetId/certificates', (req, res, next) =>
  res.format({
    html: () => listDatasetCertificatesPage(req, res, next),
    json: () => listDatasetCertificatesData(req, res, next),
    'application/atom+xml': () => listDatasetCertificatesFeed(req, res, next),
    'application/rss+xml': () => listDatasetCertificatesFeed(req, res, next)
  })
);

// Explicit JSON extension route for single certificate redirect
router.get('/:datasetId/certificate.json', async (req, res, next) => {
  try {
    const user = await getCurrentUser(req);
    const result = await getSingleCertificateId(req.params.datasetId, user);
    if (result.error) {
      const error = new Error(result.error);
      error.status = 404;
      return next(error);
    }
    if (result.certificateId) {
      return res.redirect(302, `/datasets/${result.datasetId}/certificates/${result.certificateId}.json`);
    } else {
      return res.redirect(302, `/datasets/${req.params.datasetId}/certificates.json`);
    }
  } catch (err) {
    return next(err);
  }
});

router.get('/:datasetId/certificate', async (req, res, next) => {
  try {
    const user = await getCurrentUser(req);
    const result = await getSingleCertificateId(req.params.datasetId, user);
    if (result.error) {
      const error = new Error(result.error);
      error.status = 404;
      return next(error);
    }
    if (result.certificateId) {
      return res.redirect(302, `/datasets/${result.datasetId}/certificates/${result.certificateId}`);
    } else {
      return res.redirect(302, `/datasets/${req.params.datasetId}/certificates`);
    }
  } catch (err) {
    return next(err);
  }
});

router.get('/:datasetId/certificate/embed', async (req, res, next) => {
  try {
    const user = await getCurrentUser(req);
    const result = await getSingleCertificateId(req.params.datasetId, user);
    if (result.error) {
      const error = new Error(result.error);
      error.status = 404;
      return next(error);
    }
    if (result.certificateId) {
      return res.redirect(302, `/datasets/${result.datasetId}/certificates/${result.certificateId}/embed`);
    } else {
      return res.redirect(302, `/datasets/${req.params.datasetId}/certificates`);
    }
  } catch (err) {
    return next(err);
  }
});

router.get('/:datasetId/certificate/badge.png', async (req, res, next) => {
  try {
    const user = await getCurrentUser(req);
    const result = await getSingleCertificateId(req.params.datasetId, user);
    if (result.error) {
      const error = new Error(result.error);
      error.status = 404;
      return next(error);
    }
    if (result.certificateId) {
      return res.redirect(302, `/datasets/${result.datasetId}/certificates/${result.certificateId}/badge.png`);
    } else {
      const error = new Error('No single certificate found for badge');
      error.status = 404;
      return next(error);
    }
  } catch (err) {
    return next(err);
  }
});

router.get('/:datasetId/certificate/badge.js', async (req, res, next) => {
  try {
    const user = await getCurrentUser(req);
    const result = await getSingleCertificateId(req.params.datasetId, user);
    if (result.error) {
      const error = new Error(result.error);
      error.status = 404;
      return next(error);
    }
    if (result.certificateId) {
      return res.redirect(302, `/datasets/${result.datasetId}/certificates/${result.certificateId}/badge.js`);
    } else {
      const error = new Error('No single certificate found for badge');
      error.status = 404;
      return next(error);
    }
  } catch (err) {
    return next(err);
  }
});

// Delete routes
router.delete('/:datasetId', ensureAuthenticated, deleteDataset);
router.delete('/:datasetId/certificates/:certificateId', ensureAuthenticated, deleteCertificate);

export default router;


