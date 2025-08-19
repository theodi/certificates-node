import Dataset from '../models/Dataset.js';
import Survey from '../models/Survey.js';
import Certificate from '../models/Certificate.js';
import User from '../models/User.js';
import { getLevelName } from '../utils/levels.js';

function generateAccessCode(length = 12) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghijkmnopqrstuvwxyz';
  let out = '';
  for (let i = 0; i < length; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}

export async function getCurrentUser(req) {
  const sessionUser = req.session?.passport ? req.session.passport.user : req.session?.user;
  if (!sessionUser) return null;
  if (sessionUser.id) return await User.findById(sessionUser.id).lean();
  if (sessionUser.email) return await User.findOne({ email: sessionUser.email }).lean();
  return null;
}

// Middleware for per-resource access if needed later
export async function ensureAdminOrOwner(req, res, next) {
  try {
    const user = await getCurrentUser(req);
    if (!user) return res.redirect('/auth/google');
    if (user.admin) return next();
    const { id } = req.params;
    const rs = await Certificate.findById(id).select('userId');
    if (rs && String(rs.userId) === String(user._id)) return next();
    {
      const error = new Error('Forbidden');
      error.status = 403;
      return next(error);
    }
  } catch (e) {
    const error = new Error('Server error');
    error.status = 500;
    return next(error);
  }
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

export async function createDraftCertificate(req, res, next) {
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
        const existing = await Certificate.findById(copyFrom).select('responses').lean();
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

    const certificate = await Certificate.create({
      datasetId: dataset._id,
      surveyId: survey._id,
      userId: user._id,
      state: 'draft',
      locale: preferredLocale,
      responses: prefill,
      accessCode: generateAccessCode(14)
    });

    return res.redirect(`/datasets/${dataset._id}/certificates/${certificate._id}/edit`);
  } catch (err) {
    console.error('Error creating draft certificate:', err);
    const error = new Error('Failed to create draft certificate');
    error.status = 500;
    return next(error);
  }
}

export async function renderEditCertificatePage(req, res, next) {
  try {
    const user = await getCurrentUser(req);
    if (!user) return res.redirect('/auth/google');
    const { certificateId } = req.params;
    const certificate = await Certificate.findById(certificateId).select('_id surveyId datasetId state userId').lean();
    if (!certificate) {
      const error = new Error('Certificate not found');
      error.status = 404;
      return next(error);
    }
    // Only owner or admin can edit draft
    const isOwner = String(certificate.userId) === String(user._id);
    if (!(user.admin || isOwner)) {
      const error = new Error('Forbidden');
      error.status = 403;
      return next(error);
    }
    const page = { title: 'Edit Certificate', link: '/datasets/my' };
    res.locals.page = page;
    res.render('pages/survey/edit', { certificateId: String(certificate._id), surveyId: String(certificate.surveyId), datasetId: String(certificate.datasetId) });
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
    const certificateCount = await Certificate.countDocuments({ datasetId: dataset._id });
    
    // Count other users connected to this dataset
    const otherUsers = dataset.managerUserIds ? 
      dataset.managerUserIds.filter(id => String(id) !== String(user._id)) : [];
    
    // Count certificates by other users
    const otherUserCertificates = await Certificate.countDocuments({
      datasetId: dataset._id,
      userId: { $in: otherUsers }
    });

    // Check if user has any certificates for this dataset
    const userCertificates = await Certificate.countDocuments({
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

export async function listMyDatasetsPage(req, res) {
  const page = { title: 'My Datasets', link: '/datasets/my' };
  res.locals.page = page;
  res.render('pages/datasets/index');
}

export async function listMyDatasetsData(req, res, next) {
  try {
    const user = await getCurrentUser(req);
    const isAdmin = !!user?.admin;
    const ownedMatch = isAdmin ? {} : { userId: user?._id };
    const managedFilter = isAdmin ? {} : { managerUserIds: user?._id };

    // Aggregate to one row per dataset (for datasets where the user has any response set)
    const grouped = await Certificate.aggregate([
      { $match: ownedMatch },
      { $group: {
          _id: '$datasetId',
          myCount: { $sum: 1 },
          latestUpdatedAt: { $max: '$updatedAt' },
          maxLevel: { $max: '$attainedLevel' },
          surveyIds: { $addToSet: '$surveyId' }
      }}
    ]);

    const datasetIdToAgg = new Map(grouped.map(g => [String(g._id), g]));
    const datasetIds = grouped.map(g => g._id);
    // Datasets the user manages (union with datasets they have certificates in)
    const datasetQuery = isAdmin
      ? {}
      : { $or: [ { _id: { $in: datasetIds } }, managedFilter ] };
    const datasets = await Dataset.find(datasetQuery)
      .select('_id title url removed legacyId createdAt updatedAt')
      .lean();

    // Fetch survey data for all response sets to get proper level names
    const allSurveyIds = [...new Set(grouped.flatMap(g => g.surveyIds))];
    const surveys = await Survey.find({ _id: { $in: allSurveyIds } })
      .select('_id title localle localleText levels')
      .lean();
    
    const surveyMap = new Map(surveys.map(s => [String(s._id), s]));

    const cap = (s) => (typeof s === 'string' && s.length) ? s.charAt(0).toUpperCase() + s.slice(1) : s;

    const data = datasets.map(ds => {
      const agg = datasetIdToAgg.get(String(ds._id));
      // For now, use the first survey found for this dataset (could be enhanced to show multiple)
      const firstSurveyId = agg?.surveyIds?.[0];
      const survey = firstSurveyId ? surveyMap.get(String(firstSurveyId)) : null;
      
      return {
        id: String(ds._id),
        legacyId: ds.legacyId || null,
        dataTitle: ds.title,
        webpage: ds.url,
        myCount: agg?.myCount || 0,
        levelLabel: cap(getLevelName(survey, agg?.maxLevel ?? 0)),
        updatedAt: agg?.latestUpdatedAt || ds.updatedAt,
        actions: `/datasets/${String(ds._id)}`
      };
    });

    res.json({ data });
  } catch (err) {
    console.error('Error listing datasets from response sets:', err);
    const error = new Error('Failed to list datasets');
    error.status = 500;
    return next(error);
  }
}

// Public list: datasets with at least one published certificate
export async function listPublicDatasetsPage(req, res) {
  const page = { title: 'Published Datasets', link: '/datasets' };
  res.locals.page = page;
  res.render('pages/datasets/index');
}

export async function listPublicDatasetsData(req, res, next) {
  try {
    // Aggregate datasets that have at least one published response set
    const grouped = await Certificate.aggregate([
      { $match: { state: 'published' } },
      { $group: {
          _id: '$datasetId',
          pubCount: { $sum: 1 },
          latestUpdatedAt: { $max: '$updatedAt' },
          maxLevel: { $max: '$attainedLevel' }
      }}
    ]);

    const datasetIdToAgg = new Map(grouped.map(g => [String(g._id), g]));
    const datasetIds = grouped.map(g => g._id);
    const datasets = await Dataset.find({ _id: { $in: datasetIds }, removed: { $ne: true } })
      .select('_id title url legacyId updatedAt')
      .lean();

    const cap = (s) => (typeof s === 'string' && s.length) ? s.charAt(0).toUpperCase() + s.slice(1) : s;

    const data = datasets.map(ds => {
      const agg = datasetIdToAgg.get(String(ds._id));
      return {
        id: String(ds._id),
        legacyId: ds.legacyId || null,
        dataTitle: ds.title,
        webpage: ds.url,
        myCount: agg?.pubCount || 0,
        updatedAt: agg?.latestUpdatedAt || ds.updatedAt,
        actions: `/datasets/${String(ds._id)}`
      };
    });

    res.json({ data });
  } catch (err) {
    console.error('Error listing public datasets:', err);
    const error = new Error('Failed to list datasets');
    error.status = 500;
    return next(error);
  }
}

export async function listPublicDatasetsFeed(req, res, next) {
  try {
    // Parse pagination parameters
    const limit = Math.min(parseInt(req.query.limit) || 50, 100); // Max 100 per page
    const cursor = req.query.cursor; // ISO timestamp string
    const page = parseInt(req.query.page) || 1; // Keep for backward compatibility

    // Build match conditions
    const matchConditions = { state: 'published' };
    
    // If cursor provided, use cursor-based pagination
    if (cursor) {
      matchConditions.latestUpdatedAt = { $lt: new Date(cursor) };
    }

    // Aggregate datasets that have at least one published response set
    const grouped = await Certificate.aggregate([
      { $match: { state: 'published' } },
      { $group: {
          _id: '$datasetId',
          pubCount: { $sum: 1 },
          latestUpdatedAt: { $max: '$updatedAt' },
          maxLevel: { $max: '$attainedLevel' },
          surveyIds: { $addToSet: '$surveyId' }
      }},
      { $sort: { latestUpdatedAt: -1 } },
      ...(cursor ? [] : [{ $skip: (page - 1) * limit }]), // Only use skip for backward compatibility
      { $limit: limit + 1 } // Get one extra to check if there's a next page
    ]);

    const hasNext = grouped.length > limit;
    const groupedData = grouped.slice(0, limit); // Remove the extra item

    const datasetIdToAgg = new Map(groupedData.map(g => [String(g._id), g]));
    const datasetIds = groupedData.map(g => g._id);
    const datasets = await Dataset.find({ _id: { $in: datasetIds }, removed: { $ne: true } })
      .select('_id title url legacyId updatedAt')
      .lean();

    // Fetch survey data for all response sets to get proper level names
    const allSurveyIds = [...new Set(grouped.flatMap(g => g.surveyIds))];
    const surveys = await Survey.find({ _id: { $in: allSurveyIds } })
      .select('_id title localle localleText levels')
      .lean();
    
    const surveyMap = new Map(surveys.map(s => [String(s._id), s]));

    const cap = (s) => (typeof s === 'string' && s.length) ? s.charAt(0).toUpperCase() + s.slice(1) : s;

    const feedData = datasets.map(ds => {
      const agg = datasetIdToAgg.get(String(ds._id));
      // For now, use the first survey found for this dataset (could be enhanced to show multiple)
      const firstSurveyId = agg?.surveyIds?.[0];
      const survey = firstSurveyId ? surveyMap.get(String(firstSurveyId)) : null;
      
      return {
        id: String(ds._id),
        legacyId: ds.legacyId || null,
        dataTitle: ds.title,
        webpage: ds.url,
        levelName: cap(getLevelName(survey, agg?.maxLevel ?? 0)),
        surveyTitle: survey?.title || 'Certificate',
        updatedAt: agg?.latestUpdatedAt || ds.updatedAt
      };
    });

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    
    res.set('Content-Type', 'application/atom+xml');
    // Get the cursor for the next page
    const nextCursor = hasNext ? groupedData[groupedData.length - 1].latestUpdatedAt.toISOString() : null;
    
    res.render('pages/datasets/feed', { 
      datasets: feedData, 
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
    console.error('Error generating RSS feed:', err);
    const error = new Error('Failed to generate feed');
    error.status = 500;
    return next(error);
  }
}


