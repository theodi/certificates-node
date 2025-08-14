/**
 * Centralized level utilities for consistent level handling across the application
 */

/**
 * Get level names from a survey's levels Map
 * @param {Object} survey - Survey document with levels Map
 * @returns {Array} Array of level names in order
 */
export function getLevelNames(survey) {
  if (!survey || !survey.levels) {
    return ['None', 'Basic', 'Pilot', 'Standard', 'Exemplar']; // Fallback
  }
  
  // Handle both Map objects and plain objects (from .lean())
  let levelEntries;
  if (survey.levels instanceof Map) {
    levelEntries = Array.from(survey.levels.entries());
  } else if (typeof survey.levels === 'object' && survey.levels !== null) {
    levelEntries = Object.entries(survey.levels);
  } else {
    return ['None', 'Basic', 'Pilot', 'Standard', 'Exemplar']; // Fallback
  }
  
  // Sort by key (assuming keys are numeric strings like "0", "1", "2", etc.)
  levelEntries.sort((a, b) => parseInt(a[0]) - parseInt(b[0]));
  return levelEntries.map(([key, level]) => level.title || key);
}

/**
 * Get level name for a specific index from a survey
 * @param {Object} survey - Survey document with levels Map
 * @param {number} index - Level index
 * @returns {string} Level name
 */
export function getLevelName(survey, index) {
  if (!survey || !survey.levels) {
    const fallbackNames = ['None', 'Basic', 'Pilot', 'Standard', 'Exemplar'];
    return fallbackNames[index] || 'None';
  }
  
  // Handle both Map objects and plain objects (from .lean())
  let level;
  if (survey.levels instanceof Map) {
    level = survey.levels.get(String(index));
  } else if (typeof survey.levels === 'object' && survey.levels !== null) {
    level = survey.levels[String(index)];
  } else {
    const fallbackNames = ['None', 'Basic', 'Pilot', 'Standard', 'Exemplar'];
    return fallbackNames[index] || 'None';
  }
  
  return level?.title || String(index);
}

/**
 * Get level description for a specific index from a survey
 * @param {Object} survey - Survey document with levels Map
 * @param {number} index - Level index
 * @returns {string} Level description
 */
export function getLevelDescription(survey, index) {
  if (!survey || !survey.levels) return '';
  
  // Handle both Map objects and plain objects (from .lean())
  let level;
  if (survey.levels instanceof Map) {
    level = survey.levels.get(String(index));
  } else if (typeof survey.levels === 'object' && survey.levels !== null) {
    level = survey.levels[String(index)];
  } else {
    return '';
  }
  
  return level?.description || '';
}

/**
 * Get level icon for a specific index from a survey
 * @param {Object} survey - Survey document with levels Map
 * @param {number} index - Level index
 * @returns {string} Level icon
 */
export function getLevelIcon(survey, index) {
  if (!survey || !survey.levels) return '';
  
  // Handle both Map objects and plain objects (from .lean())
  let level;
  if (survey.levels instanceof Map) {
    level = survey.levels.get(String(index));
  } else if (typeof survey.levels === 'object' && survey.levels !== null) {
    level = survey.levels[String(index)];
  } else {
    return '';
  }
  
  return level?.icon || '';
}

/**
 * Get the number of levels in a survey
 * @param {Object} survey - Survey document with levels Map
 * @returns {number} Number of levels
 */
export function getLevelCount(survey) {
  if (!survey || !survey.levels) return 5; // Fallback
  
  // Handle both Map objects and plain objects (from .lean())
  if (survey.levels instanceof Map) {
    return survey.levels.size;
  } else if (typeof survey.levels === 'object' && survey.levels !== null) {
    return Object.keys(survey.levels).length;
  }
  
  return 5; // Fallback
}

/**
 * Validate if a level index is within the valid range for a survey
 * @param {Object} survey - Survey document with levels Map
 * @param {number} index - Level index to validate
 * @returns {boolean} True if valid
 */
export function isValidLevelIndex(survey, index) {
  if (typeof index !== 'number' || index < 0) return false;
  return index < getLevelCount(survey);
}
