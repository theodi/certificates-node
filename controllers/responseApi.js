import ResponseSet from '../models/ResponseSet.js';
import Survey from '../models/Survey.js';
import Dataset from '../models/Dataset.js';
import { getCurrentUser } from './responseSets.js';
import LevelCalculationService from '../services/levelCalculationService.js';
import { getLevelName } from '../utils/levels.js';

// GET JSON: survey definition by id
export async function getSurveyJson(req, res) {
  const { surveyId } = req.params;
  const survey = await Survey.findById(surveyId).lean();
  if (!survey) return res.status(404).json({ error: 'Survey not found' });
  const pages = (survey.sections || []).map((section) => ({
    name: section.name,
    title: section.title,
    description: section.description,
    elements: section.elements || []
  }));
  return res.json({
    _id: String(survey._id),
    localle: survey.localle,
    localleText: survey.localleText,
    title: survey.title,
    fullTitle: survey.fullTitle,
    description: survey.description,
    levels: survey.levels,
    pages
  });
}

// GET JSON: concise certificate format for public API
export async function getCertificateJson(req, res, next) {
  try {
    const { responseSetId } = req.params;
    const rs = await ResponseSet.findById(responseSetId).lean();
    if (!rs) return res.status(404).json({ error: 'Certificate not found' });
    
    // Access control: published certificates are public; otherwise only admin or owner
    if (rs.state !== 'published') {
      const user = await getCurrentUser(req);
      const isOwner = user && String(user._id) === String(rs.userId);
      if (!(user && (user.admin || isOwner))) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }

    // Get survey and dataset data
    const [survey, dataset] = await Promise.all([
      Survey.findById(rs.surveyId).lean(),
      Dataset.findById(rs.datasetId).lean()
    ]);

    if (!survey) return res.status(404).json({ error: 'Survey not found' });
    if (!dataset) return res.status(404).json({ error: 'Dataset not found' });

    // Get base URL for badge links
    const protocol = req.protocol;
    const host = req.get('host');
    const baseUrl = `${protocol}://${host}`;
    const certificateUri = `${baseUrl}/datasets/${rs.datasetId}/certificates/${rs._id}`;
    const datasetUri = `${baseUrl}/datasets/${rs.datasetId}`;
    const surveyUri = `${baseUrl}/surveys/${rs.surveyId}`;

    const certificateJson = {
      version: 0.1,
      license: "http://opendatacommons.org/licenses/odbl/",
      certificate: {
        title: `${survey.title} for ${rs.responses?.dataTitle || dataset.title || 'Untitled Dataset'}`,
        uri: certificateUri,
        jurisdiction: survey.localle?.toUpperCase?.() || 'GB',
        status: survey.status || 'alpha',
        certification_type: "self certified",
        attainedLevel: rs.attainedLevel,
        levelName: getLevelName(survey, rs.attainedLevel),
        badges: {
          "application/javascript": `${certificateUri}/badge.js`,
          "text/html": `${certificateUri}/badge.html`,
          "image/png": `${certificateUri}/badge.png`
        },
        survey: {
          uri: surveyUri,
          title: survey.title,
        },
        dataset: {
          uri: datasetUri,
          title: dataset.title,
          webpage: dataset.url,
          ...rs.responses
        }
      }
    };

    return res.json(certificateJson);
  } catch (err) {
    console.error('Error generating certificate JSON:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// PATCH JSON: partial save answers
export async function saveResponsesPatch(req, res) {
  const user = await getCurrentUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const { responseSetId } = req.params;
  const { responses } = req.body || {};
  const rs = await ResponseSet.findById(responseSetId);
  if (!rs) return res.status(404).json({ error: 'Not found' });
  if (!(user.admin || String(rs.userId) === String(user._id))) return res.status(403).json({ error: 'Forbidden' });
  if (!rs.canModify()) return res.status(409).json({ error: 'Not editable' });

  if (responses && typeof responses === 'object') {
    // responses is a flat map of name -> value
    for (const [name, value] of Object.entries(responses)) {
      if (value !== null && value !== undefined) {
        rs.setResponse(name, value);
      }
    }
  }
  // Recalculate level/progress using current survey
  try {
    const survey = await LevelCalculationService.loadSurveyById(rs.surveyId);
    const newLevel = await LevelCalculationService.calculateLevel(rs, survey);
    rs.attainedLevel = newLevel;
    rs.attainedIndex = newLevel;
    console.log('newLevel', newLevel);
    await rs.save();
    const progress = await LevelCalculationService.calculateProgress(rs, survey);
    return res.json({ ok: true, attainedLevel: rs.attainedLevel, progress });
  } catch (e) {
    await rs.save();
    return res.json({ ok: true, attainedLevel: rs.attainedLevel });
  }
}

// POST: publish draft (optional for later)
export async function publishCertificate(req, res) {
  const user = await getCurrentUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const { responseSetId } = req.params;
  const rs = await ResponseSet.findById(responseSetId);
  if (!rs) return res.status(404).json({ error: 'Not found' });
  if (!(user.admin || String(rs.userId) === String(user._id))) return res.status(403).json({ error: 'Forbidden' });
  try {
    const survey = await LevelCalculationService.loadSurveyById(rs.surveyId);
    const lvl = await LevelCalculationService.calculateLevel(rs, survey);
    rs.attainedLevel = lvl;
    rs.attainedIndex = lvl;
  } catch (_) {}
  rs.state = 'published';
  await rs.save();
  return res.json({ ok: true, attainedLevel: rs.attainedLevel });
}

export async function unpublishCertificate(req, res) {
  const user = await getCurrentUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const { responseSetId } = req.params;
  const rs = await ResponseSet.findById(responseSetId);
  if (!rs) return res.status(404).json({ error: 'Not found' });
  if (!(user.admin || String(rs.userId) === String(user._id))) return res.status(403).json({ error: 'Forbidden' });
  try {
    const survey = await LevelCalculationService.loadSurveyById(rs.surveyId);
    const lvl = await LevelCalculationService.calculateLevel(rs, survey);
    rs.attainedLevel = lvl;
    rs.attainedIndex = lvl;
  } catch (_) {}
  rs.state = 'draft';
  await rs.save();
  return res.json({ ok: true, attainedLevel: rs.attainedLevel });
}


