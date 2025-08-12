import express from 'express';
import Survey from '../models/Survey.js';

const router = express.Router();

// GET /data/survey - return the latest non-alpha survey
router.get('/survey', async (req, res) => {
  try {
    const survey = await Survey.findOne({ status: { $ne: 'alpha' } })
      .sort({ version: -1, createdAt: -1 })
      .lean();

    if (!survey) {
      return res.status(404).json({ error: 'No survey found' });
    }

    const pages = (survey.sections || []).map((section) => ({
      name: section.name,
      title: section.title,
      description: section.description,
      elements: section.elements || []
    }));

    res.json({
      localle: survey.localle,
      localleText: survey.localleText,
      title: survey.title,
      fullTitle: survey.fullTitle,
      description: survey.description,
      requirementLevels: survey.requirementLevels,
      pages
    });
  } catch (error) {
    console.error('Error loading survey from DB:', error.message);
    res.status(500).json({ error: 'Failed to load survey from database' });
  }
});

export default router;

