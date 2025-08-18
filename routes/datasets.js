import express from 'express';
import { ensureAuthenticated } from '../middleware/auth.js';
import { listResponseSetsPage, listResponseSetsData, listPublicDatasetsPage, listPublicDatasetsData, listPublicDatasetsFeed, getCurrentUser } from '../controllers/responseSets.js';
import { renderCertificate, listDatasetCertificatesPage, listDatasetCertificatesFeed, listDatasetCertificatesData, deleteCertificate, renderCertificateBadge, renderCertificateBadgeJs, getSingleCertificateId } from '../controllers/certificates.js';
import { newDatasetPage, createOrSelectDataset, chooseSurveyPage, chooseSurveyData, createDraftResponseSet, renderEditResponseSetPage, deleteDataset } from '../controllers/datasets.js';
import { getCertificateJson, saveResponsesPatch, publishCertificate, unpublishCertificate } from '../controllers/responseApi.js';

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
    html: () => listResponseSetsPage(req, res, next),
    json: () => listResponseSetsData(req, res, next)
  })
);

// Create/select dataset and certificate flow
router.get('/new', ensureAuthenticated, newDatasetPage);
router.post('/new', ensureAuthenticated, createOrSelectDataset);
router.get('/:datasetId/new', ensureAuthenticated, chooseSurveyPage);
router.post('/:datasetId/new', ensureAuthenticated, createDraftResponseSet);
router.get('/:datasetId/certificates/new', ensureAuthenticated, chooseSurveyPage);
router.post('/:datasetId/certificates/new', ensureAuthenticated, createDraftResponseSet);
router.get('/:datasetId/certificates/:responseSetId/edit', ensureAuthenticated, renderEditResponseSetPage);

// Explicit JSON extension route must be BEFORE the generic param route to avoid shadowing
router.get('/:datasetId/certificates/:responseSetId.json', (req, res, next) => {
  return getCertificateJson(req, res, next);
});

// Editor API/content negotiation on the same resource path
router.get('/:datasetId/certificates/:responseSetId', (req, res, next) =>
  res.format({
    html: () => renderCertificate(req, res, next),
    json: () => getCertificateJson(req, res, next)
  })
);

router.get('/:datasetId/certificates/:responseSetId/badge.png', (req, res, next) => {
  return renderCertificateBadge(req, res, next);
});
router.get('/:datasetId/certificates/:responseSetId/badge.js', (req, res, next) => {
  return renderCertificateBadgeJs(req, res, next);
});
router.get('/:datasetId/certificates/:responseSetId/embed', (req, res, next) => {
  req.embed = true;
  return renderCertificate(req, res, next);
});
router.patch('/:datasetId/certificates/:responseSetId', ensureAuthenticated, saveResponsesPatch);
router.post('/:datasetId/certificates/:responseSetId/publish', ensureAuthenticated, publishCertificate);
router.post('/:datasetId/certificates/:responseSetId/unpublish', ensureAuthenticated, unpublishCertificate);

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
router.delete('/:datasetId/certificates/:responseSetId', ensureAuthenticated, deleteCertificate);

export default router;


