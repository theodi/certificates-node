import express from 'express';
import { ensureAuthenticated } from '../middleware/auth.js';
import { listResponseSetsPage, listResponseSetsData, listDatasetCertificatesPage, listDatasetCertificatesData, listPublicDatasetsPage, listPublicDatasetsData } from '../controllers/responseSets.js';
import { renderCertificate, listDatasetCertificates, deleteCertificate } from '../controllers/certificates.js';
import { newDatasetPage, createOrSelectDataset, chooseSurveyPage, chooseSurveyData, createDraftResponseSet, renderEditResponseSetPage, deleteDataset } from '../controllers/datasets.js';
import { getResponseSetJson, saveResponsesPatch, publishDraft } from '../controllers/responseApi.js';

const router = express.Router();

// Public list of datasets with published certificates (content negotiation)
router.get('/', (req, res, next) =>
  res.format({
    html: () => listPublicDatasetsPage(req, res, next),
    json: () => listPublicDatasetsData(req, res, next)
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

// Editor API/content negotiation on the same resource path
router.get('/:datasetId/certificates/:responseSetId', (req, res, next) =>
  res.format({
    html: () => renderCertificate(req, res, next),
    json: () => getResponseSetJson(req, res, next)
  })
);
router.patch('/:datasetId/certificates/:responseSetId', ensureAuthenticated, saveResponsesPatch);
router.post('/:datasetId/certificates/:responseSetId/publish', ensureAuthenticated, publishDraft);

// Drill-down: certificates for a dataset (public: published; logged-in: owner/admin rules) with content negotiation
router.get('/:id', (req, res, next) =>
  res.format({
    html: () => listDatasetCertificatesPage(req, res, next),
    json: () => listDatasetCertificatesData(req, res, next)
  })
);

// Certificates (public/published, or owner when logged in)
router.get('/:datasetId/certificates', listDatasetCertificates);

// Delete routes
router.delete('/:datasetId', ensureAuthenticated, deleteDataset);
router.delete('/:datasetId/certificates/:responseSetId', ensureAuthenticated, deleteCertificate);

export default router;


