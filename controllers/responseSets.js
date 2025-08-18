import ResponseSet from '../models/ResponseSet.js';
import User from '../models/User.js';
import Dataset from '../models/Dataset.js';
import { getLevelName } from '../utils/levels.js';
import Survey from '../models/Survey.js';

export async function getCurrentUser(req) {
  const sessionUser = req.session?.passport ? req.session.passport.user : req.session?.user;
  if (!sessionUser) return null;
  if (sessionUser.id) return await User.findById(sessionUser.id).lean();
  if (sessionUser.email) return await User.findOne({ email: sessionUser.email }).lean();
  return null;
}

export async function listResponseSetsPage(req, res) {
  const page = { title: 'My Datasets', link: '/datasets/my' };
  res.locals.page = page;
  res.render('pages/datasets/index');
}

export async function listResponseSetsData(req, res, next) {
  try {
    const user = await getCurrentUser(req);
    const isAdmin = !!user?.admin;
    const ownedMatch = isAdmin ? {} : { userId: user?._id };
    const managedFilter = isAdmin ? {} : { managerUserIds: user?._id };

    // Aggregate to one row per dataset (for datasets where the user has any response set)
    const grouped = await ResponseSet.aggregate([
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
    const grouped = await ResponseSet.aggregate([
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
    const grouped = await ResponseSet.aggregate([
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

// Middleware for per-resource access if needed later
export async function ensureAdminOrOwner(req, res, next) {
  try {
    const user = await getCurrentUser(req);
    if (!user) return res.redirect('/auth/google');
    if (user.admin) return next();
    const { id } = req.params;
    const rs = await ResponseSet.findById(id).select('userId');
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


