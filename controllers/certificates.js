import ResponseSet from '../models/ResponseSet.js';
import Survey from '../models/Survey.js';
import Dataset from '../models/Dataset.js';
import { getCurrentUser } from './responseSets.js';
import { getLevelName, getLevelNames } from '../utils/levels.js';

function localizedText(val, locale = 'en') {
  if (!val) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'object') {
    // Prefer requested locale, then English, then default
    return val[locale] || val.en || val.default || '';
  }
  return '';
}

function isUrl(text) {
  return typeof text === 'string' && /^https?:\/\//i.test(text);
}

function resolveAnswerEntries(element, responseValue, locale = 'en') {
  const entries = [];
  if (responseValue == null) return entries;

  const push = (text) => {
    if (text == null || text === '') return;
    entries.push({ text, isLink: isUrl(text) });
  };

  // Choices (single or multi)
  if ((element.type === 'radiogroup' || element.type === 'checkbox') && Array.isArray(element.choices)) {
    const pickText = (choice) => (
      localizedText(choice?.statementText, locale) ||
      localizedText(choice?.text, locale) ||
      String(choice?.value ?? '')
    );

    if (Array.isArray(responseValue)) {
      for (const val of responseValue) {
        const match = element.choices.find(c => c.value === val);
        push(match ? pickText(match) : String(val ?? ''));
      }
    } else {
      const match = element.choices.find(c => c.value === responseValue);
      push(match ? pickText(match) : String(responseValue));
    }
    return entries;
  }

  // Text or other scalar types; may come as array if multiple answers captured
  if (Array.isArray(responseValue)) {
    for (const val of responseValue) push(String(val ?? ''));
  } else {
    push(String(responseValue));
  }

  return entries;
}

export async function renderCertificate(req, res, next) {
  try {
    const { datasetId, responseSetId } = req.params;

    // Response set id is required in the new scheme
    let rs = await ResponseSet.findById(responseSetId).lean();
    if (!rs) {
      const error = new Error('Certificate not found');
      error.status = 404;
      return next(error);
    }

    // Access control: published certificates are public; otherwise only admin or owner
    if (rs.state !== 'published') {
      const user = await getCurrentUser(req);
      const isOwner = user && String(user._id) === String(rs.userId);
      if (!(user && (user.admin || isOwner))) {
        const error = new Error('Forbidden');
        error.status = 403;
        return next(error);
      }
    }

    const survey = await Survey.findById(rs.surveyId).lean();
    if (!survey) {
      const error = new Error('Survey not found');
      error.status = 404;
      return next(error);
    }

    // Determine preferred locale from the survey; fall back to 'en'
    const preferredLocale = (() => {
      // 1) meta map hint
      let metaLocale = null;
      try {
        if (survey.metaMap && typeof survey.metaMap === 'object') {
          // metaMap can be a plain object via lean(); try common keys
          metaLocale = survey.metaMap.locale || survey.metaMap.default_locale || null;
        }
      } catch (_) {}

    // 2) title patterns like 'questionnaire.jurisdiction.GB' (extract 'gb')
      let titleCode = null;
      if (typeof survey.title === 'string') {
        const m = survey.title.match(/jurisdiction\.[A-Za-z]{2}/i);
        if (m) titleCode = m[0].split('.')[1].toLowerCase();
      }

      // 3) localle two-letter code
      let localleCode = (survey.localle || '').toString().trim().toLowerCase();
      if (localleCode && localleCode.length > 2) localleCode = localleCode.slice(0, 2);

      const candidate = (metaLocale || titleCode || localleCode || '').toLowerCase();
      // Map some jurisdiction codes to language codes where obvious
      const jurisdictionToLang = {
        gb: 'en',
        us: 'en',
        au: 'en',
        ca: 'en',
        nz: 'en',
        ie: 'en'
      };
      if (!candidate) return 'en';
      return jurisdictionToLang[candidate] || candidate;
    })();

    // Build element lookup by name for summary extraction
    const elementByName = {};
    for (const sec of (survey.sections || [])) {
      for (const el of (sec.elements || [])) {
        if (el && el.name) elementByName[el.name] = el;
      }
    }

    const getResponseValue = (name) => {
      const r = rs.responses?.[name] || (rs.responses?.get && rs.responses.get(name));
      return r?.value ?? r?.stringValue ?? r?.textValue ?? r?.choiceRef ?? null;
    };
    const getEntriesFor = (name) => {
      const el = elementByName[name] || { type: 'text' };
      const val = getResponseValue(name);
      return resolveAnswerEntries(el, val, preferredLocale);
    };

    // Summary fields with fallbacks
    const datasetTitleEntries = getEntriesFor('dataTitle');
    const datasetUrlEntries = getEntriesFor('webpage');
    // Load dataset doc for URL/title fallback
    let datasetDoc = null;
    try { if (rs.datasetId) datasetDoc = await Dataset.findById(rs.datasetId).select('title url').lean(); } catch (_) {}
    const datasetTitleFallback = (datasetDoc && datasetDoc.title) ? [{ text: datasetDoc.title, isLink: false }] : [];
    const datasetUrlFallback = (datasetDoc && datasetDoc.url) ? [{ text: datasetDoc.url, isLink: true }] : [];

    const licenseKeys = ['license', 'licence', 'rights', 'rightsStatement', 'dataLicence'];
    let licenseEntries = [];
    for (const k of licenseKeys) {
      licenseEntries = getEntriesFor(k);
      if (licenseEntries && licenseEntries.length) break;
    }
    const releaseKeys = ['releaseType', 'type_of_release', 'publicationType', 'release'];
    let releaseTypeEntries = [];
    for (const k of releaseKeys) {
      releaseTypeEntries = getEntriesFor(k);
      if (releaseTypeEntries && releaseTypeEntries.length) break;
    }

    // Build display model by merging survey structure with responses
    const sections = (survey.sections || []).map(section => {
      const items = (section.elements || []).map(el => {
        // Respect display flag for certificate
        if (el.displayOnCertificate === false) return null;
        const response = rs.responses?.[el.name] || (rs.responses?.get && rs.responses.get(el.name));
        const value = response?.value ?? response?.stringValue ?? response?.textValue ?? response?.choiceRef ?? null;
        const answers = resolveAnswerEntries(el, value, preferredLocale);
        // Choose certificate-specific title when available
        const titleForCert = localizedText(el.certificateTitle, preferredLocale) || localizedText(el.title, preferredLocale);
        return {
          title: titleForCert,
          answers
        };
      }).filter(item => item && Array.isArray(item.answers) && item.answers.length > 0);
      return {
        title: localizedText(section.title, preferredLocale),
        items
      };
    }).filter(sec => sec.items.length > 0);

    // Summary fields from responses
    const get = (key) => {
      const r = rs.responses?.[key] || (rs.responses?.get && rs.responses.get(key));
      return r?.value ?? r?.stringValue ?? r?.textValue ?? r?.choiceRef ?? '';
    };
    const dataTitle = get('dataTitle');
    const publisher = get('publisher');

    // Level details from survey.levels map
    const levelIndex = rs.attainedLevel ?? 0;
    const levelsContainer = survey.levels instanceof Map ? Object.fromEntries(survey.levels) : (survey.levels || {});
    const levelEntry = levelsContainer[String(levelIndex)] || null;
    const levelInfo = levelEntry || {
      title: getLevelName(survey, levelIndex),
      description: '',
      icon: ''
    };

    const viewModel = {
      locale: preferredLocale,
      levelName: getLevelName(survey, rs.attainedLevel),
      level: levelInfo,
      status: survey.status || 'final',
      certificateState: rs.state,
      jurisdiction: survey.localle?.toUpperCase?.() || 'GB',
      certificateTitle: survey.title || 'Open Data Certificate',
      dataTitle,
      publisher,
      summary: {
        title: (datasetTitleEntries.length ? datasetTitleEntries : datasetTitleFallback),
        url: (datasetUrlEntries.length ? datasetUrlEntries : datasetUrlFallback),
        license: licenseEntries,
        releaseType: releaseTypeEntries
      },
      sections,
      createdAt: rs.createdAt
    };

    const page = { title: dataTitle, link: `/datasets/${datasetId}/certificates/${responseSetId}` };
    res.locals.page = page;

    res.render('pages/certificates/show', viewModel);
  } catch (err) {
    console.error('Error rendering certificate', err);
    const error = new Error('Server error');
    error.status = 500;
    return next(error);
  }
}

export async function listDatasetCertificatesData(req, res, next) {
  try {
    const { datasetId } = req.params;
  
    const user = await getCurrentUser(req);
    const isAdmin = !!user?.admin;

    // Resolve dataset by legacy or mongo id
    let datasetDoc = null;
    const legacyIdNum = Number(datasetId);
    if (!Number.isNaN(legacyIdNum) && Number.isFinite(legacyIdNum)) {
      datasetDoc = await Dataset.findOne({ legacyId: legacyIdNum }).select('_id').lean();
    } else {
      datasetDoc = await Dataset.findById(datasetId).select('_id').lean();
    }
    if (!datasetDoc) {
      const error = new Error('Dataset not found');
      error.status = 404;
      return next(error);
    }

    const filter = { datasetId: datasetDoc._id };
    if (!isAdmin) {
      // Not logged in or non-admin: only published
      if (!user) {
        filter.state = 'published';
      } else {
        filter.$or = [
          { state: 'published' },
          { userId: user._id }
        ];
      }
    }

    const sets = await ResponseSet.find(filter)
      .sort({ createdAt: -1 })
      .select('_id state attainedLevel createdAt updatedAt userId surveyId')
      .lean();

    if (sets.length === 0) {
      const error = new Error('Certificate not found');
      error.status = 404;
      return next(error);
    }

    // Fetch survey data for all certificates to get proper level names and survey info
    const surveyIds = [...new Set(sets.map(s => s.surveyId))];
    const surveys = await Survey.find({ _id: { $in: surveyIds } })
      .select('_id title localle localleText levels')
      .lean();
    
    const surveyMap = new Map(surveys.map(s => [String(s._id), s]));

    // Otherwise, render a selection list
    const data = {
      datasetId: String(datasetDoc._id),
      certificates: sets.map(s => {
        const survey = surveyMap.get(String(s.surveyId));
        return {
          id: String(s._id),
          state: s.state,
          level: getLevelName(survey, s.attainedLevel),
          surveyTitle: survey?.title || 'Unknown Survey',
          surveyLocale: survey?.localle || 'Unknown',
          surveyLocaleText: survey?.localleText || '',
          createdAt: s.createdAt,
          updatedAt: s.updatedAt
        };
      })
    };

    res.json({ data: data.certificates });
  } catch (err) {
    console.error('Error listing dataset certificates:', err);
    const error = new Error('Failed to list dataset certificates');
    error.status = 500;
    return next(error);
  }
}
export async function findSingleCertificate(req, res, next) {
  try {
    const { datasetId } = req.params;
  
    const user = await getCurrentUser(req);
    const isAdmin = !!user?.admin;

    // Resolve dataset by legacy or mongo id
    let datasetDoc = null;
    const legacyIdNum = Number(datasetId);
    if (!Number.isNaN(legacyIdNum) && Number.isFinite(legacyIdNum)) {
      datasetDoc = await Dataset.findOne({ legacyId: legacyIdNum }).select('_id').lean();
    } else {
      datasetDoc = await Dataset.findById(datasetId).select('_id').lean();
    }
    if (!datasetDoc) {
      const error = new Error('Dataset not found');
      error.status = 404;
      return next(error);
    }

    const filter = { datasetId: datasetDoc._id };
    if (!isAdmin) {
      // Not logged in or non-admin: only published
      if (!user) {
        filter.state = 'published';
      } else {
        filter.$or = [
          { state: 'published' },
          { userId: user._id }
        ];
      }
    }

    const sets = await ResponseSet.find(filter)
      .sort({ createdAt: -1 })
      .select('_id state attainedLevel createdAt updatedAt userId surveyId')
      .lean();

    const published = sets.filter(s => s.state === 'published');
    if ((user && !isAdmin && sets.length === 1) || (!user && published.length === 1)) {
      const target = (user && !isAdmin) ? sets[0] : published[0];
      return res.redirect(302, `/datasets/${datasetDoc._id}/certificates/${target._id}`);
    }
    else {
      return res.redirect(302, `/datasets/${datasetDoc._id}/certificates`);
    }
  } catch (err) {
    console.error('Error finding certificate:', err);
    const error = new Error('Failed to find certificate');
    error.status = 500;
    return next(error);
  }
}

// List certificates for a dataset
export async function listDatasetCertificatesPage(req, res, next) {
  try {
    const { datasetId } = req.params;
    const page = { title: 'Dataset Certificates', link: `/datasets/${req.params.datasetId}/certificates` };
    res.locals.page = page;
    res.render('pages/certificates/list', { datasetId });
  } catch (err) {
    console.error('Error listing dataset certificates', err);
    const error = new Error('Server error');
    error.status = 500;
    return next(error);
  }
}

export async function deleteCertificate(req, res, next) {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      const error = new Error('Authentication required');
      error.status = 401;
      return next(error);
    }

    const { responseSetId } = req.params;
    const responseSet = await ResponseSet.findById(responseSetId);
    
    if (!responseSet) {
      const error = new Error('Certificate not found');
      error.status = 404;
      return next(error);
    }

    // Only the owner or admin can delete a certificate
    const isOwner = String(responseSet.userId) === String(user._id);
    if (!(user.admin || isOwner)) {
      const error = new Error('Forbidden');
      error.status = 403;
      return next(error);
    }

    // Delete the response set (which effectively deletes the certificate)
    await ResponseSet.findByIdAndDelete(responseSet._id);
    
    return res.json({ success: true, message: 'Certificate deleted successfully' });
  } catch (err) {
    console.error('Error deleting certificate:', err);
    const error = new Error('Failed to delete certificate');
    error.status = 500;
    return next(error);
  }
}


