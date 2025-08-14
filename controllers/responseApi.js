import ResponseSet from '../models/ResponseSet.js';
import Survey from '../models/Survey.js';
import { getCurrentUser } from './responseSets.js';
import LevelCalculationService from '../services/levelCalculationService.js';

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

// GET JSON: response set data for prefill
export async function getResponseSetJson(req, res) {
  const user = await getCurrentUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const { responseSetId } = req.params;
  const rs = await ResponseSet.findById(responseSetId).lean();
  if (!rs) return res.status(404).json({ error: 'Not found' });
  const isOwner = String(rs.userId) === String(user._id) || user.admin;
  if (!isOwner) return res.status(403).json({ error: 'Forbidden' });
  return res.json({
    _id: String(rs._id),
    datasetId: String(rs.datasetId),
    surveyId: String(rs.surveyId),
    state: rs.state,
    locale: rs.locale,
    attainedLevel: rs.attainedLevel,
    responses: rs.responses || {}
  });
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
    // responses is a flat map of name -> { value }
    for (const [name, payload] of Object.entries(responses)) {
      if (!payload || typeof payload !== 'object') continue;
      const value = payload.value ?? payload.textValue ?? payload.stringValue ?? payload.choiceRef ?? null;
      rs.setResponse(name, { value, valueType: payload.valueType || 'text', choiceRef: payload.choiceRef || undefined });
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
export async function publishDraft(req, res) {
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


