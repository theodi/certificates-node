import Survey from '../models/Survey.js';
import ResponseSet from '../models/ResponseSet.js';

export async function listSurveysPage(req, res, next) {
  try {
    const page = { title: 'Available Surveys', link: '/surveys' };
    res.locals.page = page;
    // Render an empty page shell; the table is populated via AJAX from the same route with JSON
    res.render('pages/surveys/index');
  } catch (err) {
    console.error('Error rendering surveys page (HTML):', err);
    const error = new Error('Failed to render surveys page');
    error.status = 500;
    return next(error);
  }
}

export async function listSurveysData(req, res, next) {
  try {
    const surveys = await Survey.find()
      .select('_id title fullTitle localle localleText version status createdAt')
      .sort({ title: 1, localle: 1, version: 1, createdAt: -1 })
      .lean();

    // Pre-compute published certificate counts per survey
    const surveyIds = surveys.map(s => s._id);
    const publishedCountsRaw = await ResponseSet.aggregate([
      { $match: { state: 'published', surveyId: { $in: surveyIds } } },
      { $group: { _id: '$surveyId', count: { $sum: 1 } } }
    ]);
    const publishedCountBySurveyId = new Map(publishedCountsRaw.map(r => [String(r._id), r.count]));

    // Build nested structure: title -> latest per locale
    const titleToLocaleLatest = new Map();
    for (const s of surveys) {
      const title = s.title || 'Untitled Survey';
      const localeKey = (s.localle || '').toLowerCase();
      if (!titleToLocaleLatest.has(title)) titleToLocaleLatest.set(title, new Map());
      const localeMap = titleToLocaleLatest.get(title);
      const existing = localeMap.get(localeKey);
      if (!existing) {
        localeMap.set(localeKey, s);
      } else {
        const prevVersion = Number(existing.version || 0);
        const curVersion = Number(s.version || 0);
        if (curVersion > prevVersion || (curVersion === prevVersion && new Date(s.createdAt) > new Date(existing.createdAt))) {
          localeMap.set(localeKey, s);
        }
      }
    }

    const titles = {};
    const titleOrder = Array.from(titleToLocaleLatest.keys()).sort((a, b) => a.localeCompare(b));
    for (const title of titleOrder) {
      const localeMap = titleToLocaleLatest.get(title);
      const items = Array.from(localeMap.values()).map(s => ({
        id: String(s._id),
        title: s.title,
        fullTitle: s.fullTitle || s.title,
        localle: s.localle,
        localleText: s.localleText,
        version: s.version || 1,
        status: s.status || 'final',
        createdAt: s.createdAt,
        publishedCount: publishedCountBySurveyId.get(String(s._id)) || 0
      })).sort((a, b) => (a.localle || '').localeCompare(b.localle || ''));
      titles[title] = items;
    }

    res.json({ titles, titleOrder });
  } catch (err) {
    console.error('Error listing surveys (JSON):', err);
    const error = new Error('Failed to list surveys');
    error.status = 500;
    return next(error);
  }
}

export async function surveyCriteriaPage(req, res, next) {
  try {
    const { surveyId } = req.params;
    const survey = await Survey.findById(surveyId).lean();
    if (!survey) {
      const error = new Error('Survey not found');
      error.status = 404;
      return next(error);
    }

    // Build requirements grouped by level
    const levels = { 1: [], 2: [], 3: [], 4: [] };
    const sections = Array.isArray(survey.sections) ? survey.sections : [];
    const safeText = (t) => typeof t === 'object' ? (t.default || t.en || '') : (t || '');
    for (const section of sections) {
      const elements = Array.isArray(section.elements) ? section.elements : [];
      for (const el of elements) {
        const base = {
          sectionTitle: safeText(section.title),
          questionName: el.name,
          questionTitle: safeText(el.title),
          visibleIf: el.visibleIf || '',
          type: el.type
        };
        if (el.requirement && el.requirement.level) {
          const levelIdx = Number(el.requirement.level) || 0;
          if (levels[levelIdx]) {
            levels[levelIdx].push({
              ...base,
              requirementText: safeText(el.requirement.progressText),
              choiceText: null
            });
          }
        }
        if (Array.isArray(el.choices)) {
          for (const choice of el.choices) {
            if (choice && choice.requirement && choice.requirement.level) {
              const levelIdx = Number(choice.requirement.level) || 0;
              const statement = safeText(choice.statementText) || safeText(choice.text) || String(choice.value || '');
              if (levels[levelIdx]) {
                levels[levelIdx].push({
                  ...base,
                  requirementText: safeText(choice.requirement.progressText),
                  choiceText: statement
                });
              }
            }
          }
        }
      }
    }

    const page = { title: `Criteria: ${survey.fullTitle || survey.title}`, link: '/surveys' };
    res.locals.page = page;
    res.render('pages/surveys/criteria', {
      survey,
      levels
    });
  } catch (err) {
    console.error('Error rendering survey criteria page:', err);
    const error = new Error('Failed to render survey criteria');
    error.status = 500;
    return next(error);
  }
}


