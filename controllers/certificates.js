import Certificate from '../models/Certificate.js';
import Survey from '../models/Survey.js';
import Dataset from '../models/Dataset.js';
import { getCurrentUser } from './datasets.js';
import { getLevelName, getLevelIcon } from '../utils/levels.js';
import LevelCalculationService from '../services/levelCalculationService.js';

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
    const { datasetId, certificateId } = req.params;
    const isEmbed = req.embed || false;

    // Response set id is required in the new scheme
    let rs = await Certificate.findById(certificateId).lean();
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
      return r ?? null;
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
    const datasetUrl = datasetDoc && datasetDoc.url;
    console.log('Dataset URL', datasetUrl);

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
        const value = response ?? null;
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
      return r ?? '';
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

    // Get base URL for embed codes
    const protocol = req.protocol;
    const host = req.get('host');
    const baseUrl = `${protocol}://${host}`;

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
        url: (datasetUrlEntries.length ? datasetUrlEntries : datasetUrl),
        license: licenseEntries,
        releaseType: releaseTypeEntries
      },
      sections,
      createdAt: rs.createdAt,
      // Add URL information for embed codes
      baseUrl,
      datasetId,
      certificateId
    };

    const page = { title: dataTitle, link: `/datasets/${datasetId}/certificates/${certificateId}` };
    res.locals.page = page;

    // Choose template based on embed flag
    const template = isEmbed ? 'pages/certificates/embed' : 'pages/certificates/show';
    res.render(template, viewModel);
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

    const sets = await Certificate.find(filter)
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
          level: s.attainedLevel,
          levelName: getLevelName(survey, s.attainedLevel),
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

export async function getSingleCertificateId(datasetId, user) {
  try {
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
      return { certificateId: null, datasetId: null, error: 'Dataset not found' };
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

    const sets = await Certificate.find(filter)
      .sort({ createdAt: -1 })
      .select('_id state attainedLevel createdAt updatedAt userId surveyId')
      .lean();

    const published = sets.filter(s => s.state === 'published');
    
    // Return the certificate ID if there's exactly one certificate
    if ((user && !isAdmin && sets.length === 1) || (!user && published.length === 1)) {
      const target = (user && !isAdmin) ? sets[0] : published[0];
      return { certificateId: target._id, datasetId: datasetDoc._id, error: null };
    } else {
      // No single certificate found
      return { certificateId: null, datasetId: datasetDoc._id, error: null };
    }
  } catch (err) {
    console.error('Error finding certificate:', err);
    return { certificateId: null, datasetId: null, error: 'Server error' };
  }
}

export async function listDatasetCertificatesFeed(req, res, next) {
  try {
    const { datasetId } = req.params;
    
    // Parse pagination parameters
    const limit = Math.min(parseInt(req.query.limit) || 50, 100); // Max 100 per page
    const cursor = req.query.cursor; // ISO timestamp string
    const page = parseInt(req.query.page) || 1; // Keep for backward compatibility
    
    // Get the dataset
    const dataset = await Dataset.findById(datasetId).select('_id title url legacyId').lean();
    if (!dataset) {
      const error = new Error('Dataset not found');
      error.status = 404;
      return next(error);
    }

    // Build query conditions
    const queryConditions = { 
      datasetId: dataset._id, 
      state: 'published' 
    };
    
    // If cursor provided, use cursor-based pagination
    if (cursor) {
      queryConditions.updatedAt = { $lt: new Date(cursor) };
    }

    // Get all published certificates for this dataset with pagination
    const certificates = await Certificate.find(queryConditions)
    .select('_id surveyId attainedLevel updatedAt')
    .sort({ updatedAt: -1 })
    .limit(limit + 1) // Get one extra to check if there's a next page
    .lean();

    const hasNext = certificates.length > limit;
    const certificatesData = certificates.slice(0, limit); // Remove the extra item

    if (certificatesData.length === 0) {
      const error = new Error('No published certificates found for this dataset');
      error.status = 404;
      return next(error);
    }

    // Fetch survey data for all certificates to get proper level names
    const surveyIds = [...new Set(certificatesData.map(c => c.surveyId))];
    const surveys = await Survey.find({ _id: { $in: surveyIds } })
      .select('_id title localle localleText levels')
      .lean();
    
    const surveyMap = new Map(surveys.map(s => [String(s._id), s]));

    const cap = (s) => (typeof s === 'string' && s.length) ? s.charAt(0).toUpperCase() + s.slice(1) : s;

    const feedData = certificatesData.map(cert => {
      const survey = surveyMap.get(String(cert.surveyId));
      return {
        certificateId: String(cert._id),
        levelName: cap(getLevelName(survey, cert.attainedLevel ?? 0)),
        surveyTitle: survey?.title || 'Certificate',
        updatedAt: cert.updatedAt
      };
    });

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    
    res.set('Content-Type', 'application/atom+xml');
    // Get the cursor for the next page
    const nextCursor = hasNext ? certificatesData[certificatesData.length - 1].updatedAt.toISOString() : null;
    
    res.render('pages/certificates/feed', { 
      dataset: {
        id: String(dataset._id),
        dataTitle: dataset.title,
        webpage: dataset.url
      },
      certificates: feedData, 
      baseUrl,
      pagination: {
        page,
        limit,
        hasNext,
        hasPrev: page > 1,
        nextCursor,
        currentCursor: cursor
      }
    });
  } catch (err) {
    console.error('Error generating dataset certificates RSS feed:', err);
    const error = new Error('Failed to generate feed');
    error.status = 500;
    return next(err);
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

    const { certificateId } = req.params;
    const certificate = await Certificate.findById(certificateId);
    
    if (!certificate) {
      const error = new Error('Certificate not found');
      error.status = 404;
      return next(error);
    }

    // Only the owner or admin can delete a certificate
    const isOwner = String(certificate.userId) === String(user._id);
    if (!(user.admin || isOwner)) {
      const error = new Error('Forbidden');
      error.status = 403;
      return next(error);
    }

    // Delete the response set (which effectively deletes the certificate)
    await Certificate.findByIdAndDelete(certificate._id);
    
    return res.json({ success: true, message: 'Certificate deleted successfully' });
  } catch (err) {
    console.error('Error deleting certificate:', err);
    const error = new Error('Failed to delete certificate');
    error.status = 500;
    return next(error);
  }
}

export async function renderCertificateBadge(req, res, next) {
  try {
    const { datasetId, certificateId } = req.params;

    // Find the response set (certificate)
    const rs = await Certificate.findById(certificateId).lean();
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

    // Get the survey to determine level names
    const survey = await Survey.findById(rs.surveyId).lean();
    if (!survey) {
      const error = new Error('Survey not found');
      error.status = 404;
      return next(error);
    }

    // Get the level icon/badge from the survey
    const levelIndex = rs.attainedLevel ?? 0;
    const levelIcon = getLevelIcon(survey, levelIndex);
    console.log(levelIcon);
    // Construct the path to the badge image
    const badgePath = `public/${levelIcon}`;
    
    // Check if the file exists
    const fs = await import('fs');
    const path = await import('path');
    
    if (!fs.existsSync(badgePath)) {
      const error = new Error('Badge image not found');
      error.status = 404;
      return next(error);
    }

    // Set appropriate headers for image serving
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
    
    // Serve the badge image
    res.sendFile(path.resolve(badgePath));
  } catch (err) {
    console.error('Error rendering certificate badge:', err);
    const error = new Error('Server error');
    error.status = 500;
    return next(error);
  }
}

export async function renderCertificateBadgeJs(req, res, next) {
  try {
    const { datasetId, certificateId } = req.params;

    // Find the response set (certificate)
      const rs = await Certificate.findById(certificateId).lean();
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

    // Get the survey to determine level names and certificate title
    const survey = await Survey.findById(rs.surveyId).lean();
    if (!survey) {
      const error = new Error('Survey not found');
      error.status = 404;
      return next(error);
    }

    // Get certificate details
    const levelIndex = rs.attainedLevel ?? 0;
    const levelName = getLevelName(survey, levelIndex);
    const certificateTitle = survey.title || 'Open Data Certificate';

    const dataTitle = rs.responses?.dataTitle || (rs.responses?.get && rs.responses.get('dataTitle')) || '';

    const badgeTitle = dataTitle ? `${dataTitle} - ${levelName} - ${certificateTitle}` : `${levelName} - ${certificateTitle}`;

    // Get the base URL for the certificate
    const protocol = req.protocol;
    const host = req.get('host');
    const baseUrl = `${protocol}://${host}`;

    // Construct the JavaScript embed code
    const jsCode = `document.write('<div class=\\'open-data-certificate\\' title=\\'${badgeTitle}\\'> <style>@import url(${baseUrl}/css/badge.css);<\\/style> <a href="${baseUrl}/datasets/${datasetId}/certificates/${certificateId}"><img alt="Badge" src="${baseUrl}/datasets/${datasetId}/certificates/${certificateId}/badge.png" /> <\\/a><p>${levelName}<\\/p> <\\/div>');`;

    // Set appropriate headers for JavaScript serving
    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
    
    // Return the JavaScript code
    res.send(jsCode);
  } catch (err) {
    console.error('Error rendering certificate badge JavaScript:', err);
    const error = new Error('Server error');
    error.status = 500;
    return next(error);
  }
}

// GET JSON: concise certificate format for public API
export async function getCertificateJson(req, res, next) {
  try {
    const { certificateId } = req.params;
    const rs = await Certificate.findById(certificateId).lean();
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
      version: 0.2,
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

// POST: publish draft (optional for later)
export async function publishCertificate(req, res) {
  const user = await getCurrentUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const { certificateId } = req.params;
  const rs = await Certificate.findById(certificateId);
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
  const { certificateId } = req.params;
  const rs = await Certificate.findById(certificateId);
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

export async function saveResponsesPatch(req, res) {
  const user = await getCurrentUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const { certificateId } = req.params;
  const { responses } = req.body || {};
  const rs = await Certificate.findById(certificateId);
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