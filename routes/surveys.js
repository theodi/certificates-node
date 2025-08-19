import express from 'express';
import { listSurveysPage, listSurveysData, surveyCriteriaPage, getSurveyJson } from '../controllers/surveys.js';

const router = express.Router();

// List surveys (HTML or JSON)
router.get('/', (req, res, next) =>
  res.format({
    html: () => listSurveysPage(req, res, next),
    json: () => listSurveysData(req, res, next)
  })
);

// Survey criteria page
router.get('/:surveyId/criteria', surveyCriteriaPage);

// Single survey: HTML (criteria) or JSON (schema)
router.get('/:surveyId', (req, res, next) =>
  res.format({
    html: () => surveyCriteriaPage(req, res, next),
    json: () => getSurveyJson(req, res, next)
  })
);



export default router;

