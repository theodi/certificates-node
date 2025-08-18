import Dataset from '../models/Dataset.js';
import Survey from '../models/Survey.js';
import ResponseSet from '../models/ResponseSet.js';
import { getCurrentUser, ensureAdminOrOwner } from './responseSets.js';

function generateAccessCode(length = 12) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghijkmnopqrstuvwxyz';
  let out = '';
  for (let i = 0; i < length; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}

export async function newDatasetPage(req, res) {
  const page = { title: 'Create or Select Dataset', link: '/datasets/new' };
  res.locals.page = page;
  res.render('pages/datasets/new');
}

export async function createOrSelectDataset(req, res, next) {
  try {
    const user = await getCurrentUser(req);
    if (!user) return res.redirect('/auth/google');
    const { url, title } = req.body || {};
    if (!url || !title) {
      const error = new Error('Missing dataset title or URL');
      error.status = 400;
      return next(error);
    }

    // Find by URL (canonicalize basic form)
    const normalizedUrl = String(url).trim();
    let dataset = await Dataset.findOne({ url: normalizedUrl, removed: { $ne: true } });
    if (!dataset) {
      dataset = await Dataset.create({ title: String(title).trim(), url: normalizedUrl, userId: user._id, managerUserIds: [user._id] });
    } else {
      // Add current user as a manager if not already
      const exists = (dataset.managerUserIds || []).some(u => String(u) === String(user._id));
      if (!exists) {
        dataset.managerUserIds = dataset.managerUserIds || [];
        dataset.managerUserIds.push(user._id);
        await dataset.save();
      }
    }
    return res.redirect(`/datasets/${dataset._id}/new`);
  } catch (err) {
    console.error('Error creating/selecting dataset:', err);
    const error = new Error('Failed to create or select dataset');
    error.status = 500;
    return next(error);
  }
}

export async function chooseSurveyPage(req, res, next) {
  try {
    const user = await getCurrentUser(req);
    if (!user) return res.redirect('/auth/google');
    const { datasetId } = req.params;
    const dataset = await Dataset.findById(datasetId).lean();
    if (!dataset) {
      const error = new Error('Dataset not found');
      error.status = 404;
      return next(error);
    }

    const surveys = await Survey.find({ status: { $ne: 'alpha' } })
      .select('_id title fullTitle localle localleText version status createdAt')
      .sort({ title: 1, version: -1, createdAt: -1 })
      .lean();

    // Group by title
    const grouped = Array.from(
      surveys.reduce((map, s) => {
        const key = s.title || 'Untitled Survey';
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(s);
        return map;
      }, new Map())
    ).map(([title, items]) => ({ title, items }));

    const page = { title: 'Select Certificate Template', link: '/datasets/new' };
    res.locals.page = page;
    res.render('pages/datasets/choose-survey', { dataset, groups: grouped });
  } catch (err) {
    console.error('Error preparing survey chooser:', err);
    const error = new Error('Failed to load survey list');
    error.status = 500;
    return next(error);
  }
}

export async function chooseSurveyData(req, res, next) {
  try {
    const { datasetId } = req.params;
    const dataset = await Dataset.findById(datasetId).select('_id title url').lean();
    if (!dataset) return res.status(404).json({ error: 'Dataset not found' });

    const surveys = await Survey.find({ status: { $ne: 'alpha' } })
      .select('_id title fullTitle localle localleText version status createdAt')
      .sort({ title: 1, version: -1, createdAt: -1 })
      .lean();

    const groups = Array.from(
      surveys.reduce((map, s) => {
        const key = s.title || 'Untitled Survey';
        if (!map.has(key)) map.set(key, []);
        map.get(key).push({
          _id: String(s._id),
          title: s.title,
          fullTitle: s.fullTitle,
          localle: s.localle,
          localleText: s.localleText,
          version: s.version,
          status: s.status
        });
        return map;
      }, new Map())
    ).map(([title, items]) => ({ title, items }));

    return res.json({ dataset: { _id: String(dataset._id), title: dataset.title, url: dataset.url }, groups });
  } catch (err) {
    console.error('Error loading surveys list (JSON):', err);
    const error = new Error('Failed to load survey list');
    error.status = 500;
    return next(error);
  }
}

export async function createDraftResponseSet(req, res, next) {
  try {
    const user = await getCurrentUser(req);
    if (!user) return res.redirect('/auth/google');
    const { datasetId } = req.params;
    const { surveyId, locale, copyFrom } = req.body || {};
    const dataset = await Dataset.findById(datasetId).lean();
    if (!dataset) {
      const error = new Error('Dataset not found');
      error.status = 404;
      return next(error);
    }
    const survey = await Survey.findById(surveyId).lean();
    if (!survey) {
      const error = new Error('Survey not found');
      error.status = 404;
      return next(error);
    }
    const preferredLocale = locale || survey.localle || 'en';

    // Prefill minimal responses for dataset metadata commonly used
    const prefill = new Map();
    prefill.set('webpage', dataset.url);
    prefill.set('dataTitle', dataset.title);

    // Optionally copy answers from an existing certificate
    if (copyFrom) {
      try {
        const existing = await ResponseSet.findById(copyFrom).select('responses').lean();
        if (existing && existing.responses) {
          const entries = existing.responses instanceof Map ? Array.from(existing.responses.entries()) : Object.entries(existing.responses);
          for (const [k, v] of entries) {
            if (!prefill.has(k) && v !== null && v !== undefined) {
              prefill.set(k, v);
            }
          }
        }
      } catch (_) {}
    }

    const rs = await ResponseSet.create({
      datasetId: dataset._id,
      surveyId: survey._id,
      userId: user._id,
      state: 'draft',
      locale: preferredLocale,
      responses: prefill,
      accessCode: generateAccessCode(14)
    });

    return res.redirect(`/datasets/${dataset._id}/certificates/${rs._id}/edit`);
  } catch (err) {
    console.error('Error creating draft response set:', err);
    const error = new Error('Failed to create draft certificate');
    error.status = 500;
    return next(error);
  }
}

export async function renderEditResponseSetPage(req, res, next) {
  try {
    const user = await getCurrentUser(req);
    if (!user) return res.redirect('/auth/google');
    const { responseSetId } = req.params;
    const rs = await ResponseSet.findById(responseSetId).select('_id surveyId datasetId state userId').lean();
    if (!rs) {
      const error = new Error('Certificate not found');
      error.status = 404;
      return next(error);
    }
    // Only owner or admin can edit draft
    const isOwner = String(rs.userId) === String(user._id);
    if (!(user.admin || isOwner)) {
      const error = new Error('Forbidden');
      error.status = 403;
      return next(error);
    }
    const page = { title: 'Edit Certificate', link: '/datasets/my' };
    res.locals.page = page;
    res.render('pages/survey/edit', { responseSetId: String(rs._id), surveyId: String(rs.surveyId), datasetId: String(rs.datasetId) });
  } catch (err) {
    console.error('Error rendering edit page:', err);
    const error = new Error('Failed to open editor');
    error.status = 500;
    return next(error);
  }
}

export async function deleteDataset(req, res, next) {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      const error = new Error('Authentication required');
      error.status = 401;
      return next(error);
    }

    const { datasetId } = req.params;
    const dataset = await Dataset.findById(datasetId);
    
    if (!dataset) {
      const error = new Error('Dataset not found');
      error.status = 404;
      return next(error);
    }

    // Check if user is owner or manager of the dataset
    const isOwner = String(dataset.userId) === String(user._id);
    const isManager = dataset.managerUserIds && dataset.managerUserIds.some(id => String(id) === String(user._id));
    
    if (!(user.admin || isOwner || isManager)) {
      const error = new Error('Forbidden');
      error.status = 403;
      return next(error);
    }

    // Count certificates for this dataset
    const certificateCount = await ResponseSet.countDocuments({ datasetId: dataset._id });
    
    // Count other users connected to this dataset
    const otherUsers = dataset.managerUserIds ? 
      dataset.managerUserIds.filter(id => String(id) !== String(user._id)) : [];
    
    // Count certificates by other users
    const otherUserCertificates = await ResponseSet.countDocuments({
      datasetId: dataset._id,
      userId: { $in: otherUsers }
    });

    // Check if user has any certificates for this dataset
    const userCertificates = await ResponseSet.countDocuments({
      datasetId: dataset._id,
      userId: user._id
    });

    if (userCertificates > 0) {
      const error = new Error('Cannot delete dataset: you have certificates for this dataset');
      error.status = 400;
      return next(error);
    }

    if (certificateCount === 0 && otherUsers.length === 0) {
      // No certificates and no other users - safe to delete the dataset
      await Dataset.findByIdAndDelete(dataset._id);
      return res.json({ success: true, message: 'Dataset deleted successfully' });
    } else if (otherUsers.length > 0) {
      // Other users exist - remove this user from the dataset
      dataset.managerUserIds = dataset.managerUserIds.filter(id => String(id) !== String(user._id));
      await dataset.save();
      return res.json({ success: true, message: 'Removed from dataset successfully' });
    } else {
      const error = new Error('Cannot delete dataset: it has certificates');
      error.status = 400;
      return next(error);
    }
  } catch (err) {
    console.error('Error deleting dataset:', err);
    const error = new Error('Failed to delete dataset');
    error.status = 500;
    return next(error);
  }
}


