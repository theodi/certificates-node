const fs = require('fs').promises;
const path = require('path');

class LevelCalculationService {
  // Cache for survey definitions
  static surveyCache = new Map();

  /**
   * Calculate the achievement level for a response set
   * @param {ResponseSet} responseSet - The response set to evaluate
   * @returns {number} - Level index (0-4)
   */
  static async calculateLevel(responseSet) {
    try {
      const survey = await this.loadSurveyDefinition(responseSet.localle || responseSet.accessCode);
      const requirements = this.extractRequirements(survey);
      
      // Check each level from highest to lowest
      for (let level = 4; level >= 0; level--) {
        if (await this.meetsLevelRequirements(responseSet, requirements, level)) {
          return level;
        }
      }
      
      return 0; // none
    } catch (error) {
      console.error('Error calculating level:', error);
      return 0;
    }
  }

  /**
   * Calculate progress information for a response set
   * @param {ResponseSet} responseSet - The response set to evaluate
   * @returns {Object} - Progress information
   */
  static async calculateProgress(responseSet) {
    try {
      const survey = await this.loadSurveyDefinition(responseSet.localle || responseSet.accessCode);
      const requirements = this.extractRequirements(survey);
      
      const progress = {
        currentLevel: responseSet.attainedLevel,
        currentLevelName: responseSet.getLevelName(),
        totalQuestions: 0,
        answeredQuestions: 0,
        requiredQuestions: 0,
        answeredRequiredQuestions: 0,
        levels: []
      };

      // Calculate progress for each level
      for (let level = 0; level <= 4; level++) {
        const levelRequirements = requirements.filter(req => req.level === level);
        const levelProgress = await this.calculateLevelProgress(responseSet, levelRequirements);
        
        progress.levels.push({
          level,
          levelName: ['none', 'basic', 'pilot', 'standard', 'exemplar'][level],
          total: levelProgress.total,
          answered: levelProgress.answered,
          required: levelProgress.required,
          answeredRequired: levelProgress.answeredRequired,
          percentage: levelProgress.total > 0 ? (levelProgress.answered / levelProgress.total * 100).toFixed(1) : 0
        });

        progress.totalQuestions += levelProgress.total;
        progress.answeredQuestions += levelProgress.answered;
        progress.requiredQuestions += levelProgress.required;
        progress.answeredRequiredQuestions += levelProgress.answeredRequired;
      }

      progress.overallPercentage = progress.totalQuestions > 0 
        ? (progress.answeredQuestions / progress.totalQuestions * 100).toFixed(1) 
        : 0;

      return progress;
    } catch (error) {
      console.error('Error calculating progress:', error);
      return {
        currentLevel: 0,
        currentLevelName: 'none',
        totalQuestions: 0,
        answeredQuestions: 0,
        requiredQuestions: 0,
        answeredRequiredQuestions: 0,
        overallPercentage: 0,
        levels: []
      };
    }
  }

  /**
   * Check if response set meets requirements for a specific level
   * @param {ResponseSet} responseSet - The response set to evaluate
   * @param {Array} requirements - All requirements
   * @param {number} level - Level to check (0-4)
   * @returns {boolean} - Whether the level is achieved
   */
  static async meetsLevelRequirements(responseSet, requirements, level) {
    const levelRequirements = requirements.filter(req => req.level === level);
    
    for (const requirement of levelRequirements) {
      if (!await this.meetsRequirement(responseSet, requirement)) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * Check if a specific requirement is met
   * @param {ResponseSet} responseSet - The response set to evaluate
   * @param {Object} requirement - The requirement to check
   * @returns {boolean} - Whether the requirement is met
   */
  static async meetsRequirement(responseSet, requirement) {
    const { questionId, expectedValue, condition } = requirement;
    
    if (!responseSet.hasResponse(questionId)) {
      return false;
    }

    const response = responseSet.getResponse(questionId);
    const value = responseSet.getResponseValue(questionId);

    // Check if question is visible (conditional logic)
    if (condition && !this.evaluateCondition(responseSet, condition)) {
      return true; // Requirement not applicable
    }

    // Check expected value
    if (expectedValue !== undefined) {
      return value === expectedValue;
    }

    // Check if response has a value
    return value !== null && value !== undefined && value !== '';
  }

  /**
   * Calculate progress for a specific level
   * @param {ResponseSet} responseSet - The response set to evaluate
   * @param {Array} levelRequirements - Requirements for the level
   * @returns {Object} - Progress information for the level
   */
  static async calculateLevelProgress(responseSet, levelRequirements) {
    let total = 0;
    let answered = 0;
    let required = 0;
    let answeredRequired = 0;

    for (const requirement of levelRequirements) {
      const { questionId, isRequired, condition } = requirement;
      
      // Check if question is visible
      if (condition && !this.evaluateCondition(responseSet, condition)) {
        continue; // Skip if not applicable
      }

      total++;
      if (isRequired) {
        required++;
      }

      if (responseSet.hasResponse(questionId)) {
        const response = responseSet.getResponse(questionId);
        const value = responseSet.getResponseValue(questionId);
        
        if (value !== null && value !== undefined && value !== '') {
          answered++;
          if (isRequired) {
            answeredRequired++;
          }
        }
      }
    }

    return { total, answered, required, answeredRequired };
  }

  /**
   * Evaluate conditional logic for question visibility
   * @param {ResponseSet} responseSet - The response set
   * @param {Object} condition - The condition to evaluate
   * @returns {boolean} - Whether the condition is met
   */
  static evaluateCondition(responseSet, condition) {
    const { questionId, operator, value } = condition;
    
    if (!responseSet.hasResponse(questionId)) {
      return false;
    }

    const responseValue = responseSet.getResponseValue(questionId);

    switch (operator) {
      case '==':
        return responseValue === value;
      case '!=':
        return responseValue !== value;
      case '>':
        return responseValue > value;
      case '<':
        return responseValue < value;
      case '>=':
        return responseValue >= value;
      case '<=':
        return responseValue <= value;
      case 'in':
        return Array.isArray(value) && value.includes(responseValue);
      case 'not_in':
        return Array.isArray(value) && !value.includes(responseValue);
      default:
        return false;
    }
  }

  /**
   * Load survey definition from JSON files
   * @param {string} jurisdiction - The jurisdiction code
   * @returns {Object} - Survey definition
   */
  static async loadSurveyDefinition(jurisdiction) {
    if (this.surveyCache.has(jurisdiction)) {
      return this.surveyCache.get(jurisdiction);
    }

    try {
      const surveyPath = path.join(__dirname, '../data/survey.json');
      const surveyData = JSON.parse(await fs.readFile(surveyPath, 'utf8'));
      
      const survey = {
        pages: surveyData.pages,
        elements: {}
      };

      // Load all page elements
      for (const page of surveyData.pages) {
        const pagePath = path.join(__dirname, `../data/pages/${page}.json`);
        const pageData = JSON.parse(await fs.readFile(pagePath, 'utf8'));
        
        if (pageData.elements) {
          for (const element of pageData.elements) {
            if (typeof element === 'string') {
              // Load sub-element
              const subElementPath = path.join(__dirname, `../data/pages/${element}.json`);
              const subElementData = JSON.parse(await fs.readFile(subElementPath, 'utf8'));
              survey.elements[element] = subElementData;
            } else {
              survey.elements[element.name] = element;
            }
          }
        }
      }

      this.surveyCache.set(jurisdiction, survey);
      return survey;
    } catch (error) {
      console.error('Error loading survey definition:', error);
      return { pages: [], elements: {} };
    }
  }

  /**
   * Extract requirements from survey definition
   * @param {Object} survey - Survey definition
   * @returns {Array} - Array of requirements
   */
  static extractRequirements(survey) {
    const requirements = [];

    for (const [elementName, element] of Object.entries(survey.elements)) {
      if (element.elements) {
        for (const subElement of element.elements) {
          if (subElement.requirement) {
            requirements.push({
              questionId: subElement.name,
              level: this.parseRequirementLevel(subElement.requirement.level),
              isRequired: subElement.isRequired || false,
              expectedValue: subElement.requirement.requireTrue,
              condition: this.parseCondition(subElement.visibleIf)
            });
          }
        }
      } else if (element.requirement) {
        requirements.push({
          questionId: element.name,
          level: this.parseRequirementLevel(element.requirement.level),
          isRequired: element.isRequired || false,
          expectedValue: element.requirement.requireTrue,
          condition: this.parseCondition(element.visibleIf)
        });
      }
    }

    return requirements;
  }

  /**
   * Parse requirement level from string to number
   * @param {string|number} level - Level value
   * @returns {number} - Level index (0-4)
   */
  static parseRequirementLevel(level) {
    if (typeof level === 'number') {
      return Math.max(0, Math.min(4, level));
    }
    
    const levelMap = {
      'none': 0,
      'basic': 1,
      'pilot': 2,
      'standard': 3,
      'exemplar': 4
    };
    
    return levelMap[level] || 0;
  }

  /**
   * Parse conditional logic from visibleIf string
   * @param {string} visibleIf - Conditional logic string
   * @returns {Object|null} - Parsed condition or null
   */
  static parseCondition(visibleIf) {
    if (!visibleIf) return null;

    // Simple parsing for basic conditions like "{questionId} = 'value'"
    const match = visibleIf.match(/\{([^}]+)\}\s*([=!<>]+)\s*['"]([^'"]+)['"]/);
    if (match) {
      return {
        questionId: match[1],
        operator: match[2],
        value: match[3]
      };
    }

    return null;
  }
}

module.exports = LevelCalculationService; 