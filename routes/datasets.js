import express from 'express';
import { ensureAuthenticated } from '../middleware/auth.js';
import { listResponseSetsPage, listResponseSetsData, listDatasetCertificatesPage, listDatasetCertificatesData, listPublicDatasetsPage, listPublicDatasetsData } from '../controllers/responseSets.js';
import { renderCertificate, listDatasetCertificates } from '../controllers/certificates.js';

const router = express.Router();

// Public list of datasets with published certificates
router.get('/', listPublicDatasetsPage);
router.get('/data', listPublicDatasetsData);

// My datasets (require auth)
router.get('/my', ensureAuthenticated, listResponseSetsPage);
router.get('/my/data', ensureAuthenticated, listResponseSetsData);

// Drill-down: certificates for a dataset (public: published; logged-in: owner/admin rules)
router.get('/:id', listDatasetCertificatesPage);
router.get('/:id/data', listDatasetCertificatesData);

// Certificates (public/published, or owner when logged in)
router.get('/:datasetId/certificates', listDatasetCertificates);
router.get('/:datasetId/certificates/:responseSetId', renderCertificate);

export default router;


