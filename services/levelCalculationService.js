import Survey from '../models/Survey.js';
import { getLevelNames, getLevelName } from '../utils/levels.js';

class LevelCalculationService {
  static surveyCache = new Map();
  static DEBUG = (process && process.env && process.env.DEBUG_LEVEL_CALC === 'true');

  static async calculateLevel(certificate, surveyDoc = null) {
    try {
      const survey = surveyDoc || await this.loadSurveyById(certificate.surveyId);
      const { levelNames, maxLevel } = this.getSurveyLevelMeta(survey);
      const requirements = this.extractRequirementsFromSections(survey, levelNames);
      if (this.DEBUG) {
        console.debug('[LevelCalc] calculateLevel: surveyId=%s reqCount=%d maxLevel=%d', String(certificate.surveyId), requirements.length, maxLevel);
      }
      for (let level = maxLevel; level >= 1; level -= 1) {
        console.debug('[LevelCalc] level %d: meetsLevelRequirements=%s', level, await this.meetsLevelRequirements(certificate, requirements, level));
        if (await this.meetsLevelRequirements(certificate, requirements, level)) {
          if (this.DEBUG) console.debug('[LevelCalc] achieved level %d', level);
          return level;
        }
      }
      return 0;
    } catch (error) {
      console.error('Error calculating level:', error);
      return 0;
    }
  }

  static async calculateProgress(certificate, surveyDoc = null) {
    try {
      const survey = surveyDoc || await this.loadSurveyById(certificate.surveyId);
      const { levelNames, maxLevel } = this.getSurveyLevelMeta(survey);
      const requirements = this.extractRequirementsFromSections(survey, levelNames);
      if (this.DEBUG) console.debug('[LevelCalc] calculateProgress: reqCount=%d maxLevel=%d', requirements.length, maxLevel);
      const progress = {
        currentLevel: Number(certificate.attainedLevel || 0),
        currentLevelName: levelNames[Number(certificate.attainedLevel || 0)] || (levelNames[0] || 'none'),
        totalQuestions: 0,
        answeredQuestions: 0,
        requiredQuestions: 0,
        answeredRequiredQuestions: 0,
        levels: []
      };
      // Cumulative progress: for each level L, consider all requirements with level <= L
      for (let level = 1; level <= maxLevel; level += 1) {
        const levelRequirements = requirements.filter(req => req.level <= level);
        const levelProgress = await this.calculateLevelProgress(certificate, levelRequirements);
        progress.levels.push({
          level,
          levelName: levelNames[level] || String(level),
          total: levelProgress.total,
          answered: levelProgress.answered,
          required: levelProgress.required,
          answeredRequired: levelProgress.answeredRequired,
          percentage: (levelProgress.required > 0)
            ? (levelProgress.answeredRequired / levelProgress.required * 100).toFixed(1)
            : (levelProgress.total > 0 ? (levelProgress.answered / levelProgress.total * 100).toFixed(1) : 0)
        });
        progress.totalQuestions += levelProgress.total;
        progress.answeredQuestions += levelProgress.answered;
        progress.requiredQuestions += levelProgress.required;
        progress.answeredRequiredQuestions += levelProgress.answeredRequired;
      }
      progress.overallPercentage = progress.totalQuestions > 0 ? (progress.answeredQuestions / progress.totalQuestions * 100).toFixed(1) : 0;
      if (this.DEBUG) {
        console.debug('[LevelCalc] progress summary: total=%d answered=%d required=%d answeredRequired=%d overall=%s%%',
          progress.totalQuestions, progress.answeredQuestions, progress.requiredQuestions, progress.answeredRequiredQuestions, String(progress.overallPercentage));
        for (const lvl of progress.levels) {
          console.debug('[LevelCalc] level %d: total=%d answered=%d required=%d answeredRequired=%d pct=%s%%',
            lvl.level, lvl.total, lvl.answered, lvl.required, lvl.answeredRequired, String(lvl.percentage));
        }
      }
      return progress;
    } catch (error) {
      console.error('Error calculating progress:', error);
      return { currentLevel: 0, currentLevelName: 'none', totalQuestions: 0, answeredQuestions: 0, requiredQuestions: 0, answeredRequiredQuestions: 0, overallPercentage: 0, levels: [] };
    }
  }

  static async loadSurveyById(surveyId) {
    if (!surveyId) throw new Error('Missing surveyId');
    const cacheKey = String(surveyId);
    if (this.surveyCache.has(cacheKey)) return this.surveyCache.get(cacheKey);
    const survey = await Survey.findById(surveyId).lean();
    if (!survey) throw new Error('Survey not found');
    this.surveyCache.set(cacheKey, survey);
    return survey;
  }

  static extractRequirementsFromSections(survey, levelNames) {
    const requirements = [];
    const sections = Array.isArray(survey?.sections) ? survey.sections : [];
    let elementCount = 0;
    for (const section of sections) {
      const elements = Array.isArray(section?.elements) ? section.elements : [];
      for (const el of elements) {
        if (!el || !el.name) continue;
        elementCount += 1;
        // Precompute choice requirement metadata for this question
        let minChoiceLevel = null;
        let choiceRequiredValues = [];
        if (Array.isArray(el.choices)) {
          const lvls = [];
          for (const ch of el.choices) {
            if (ch && ch.requirement && typeof ch.requirement.level !== 'undefined') {
              lvls.push(this.parseRequirementLevel(ch.requirement.level, levelNames));
              choiceRequiredValues.push(ch.value);
            }
          }
          if (lvls.length) minChoiceLevel = Math.min(...lvls);
        }

        // Element-level requirement (single)
        if (el.requirement) {
          requirements.push({
            questionId: el.name,
            level: this.parseRequirementLevel(el.requirement.level, levelNames),
            isRequired: true,
            expectedValue: el.requirement.requireTrue,
            condition: el.visibleIf || null,
            source: 'element',
            elementType: el.type,
            minChoiceLevel,
            choiceRequiredValues
          });
        }
        // Element-level requirements (array of per-level criteria)
        if (Array.isArray(el.requirements) && el.requirements.length) {
          for (const req of el.requirements) {
            if (!req) continue;
            requirements.push({
              questionId: el.name,
              level: this.parseRequirementLevel(req.level, levelNames),
              isRequired: true,
              expectedValue: req.requireTrue, // may be undefined; then non-empty suffices
              condition: el.visibleIf || null,
              source: 'element',
              elementType: el.type,
              minChoiceLevel,
              choiceRequiredValues
            });
          }
        }
        // Choice-level requirements
        if (Array.isArray(el.choices)) {
          for (const choice of el.choices) {
            if (choice && choice.requirement) {
              requirements.push({
                questionId: el.name,
                level: this.parseRequirementLevel(choice.requirement.level, levelNames),
                isRequired: true,
                // To satisfy this requirement, the answer must include/select this choice value
                expectedValue: (choice.value !== undefined ? choice.value : choice.requirement.requireTrue),
                condition: el.visibleIf || null,
                source: 'choice',
                elementType: el.type,
                minChoiceLevel,
                choiceRequiredValues
              });
            }
          }
        }
      }
    }
    if (this.DEBUG) console.debug('[LevelCalc] extracted from sections: sections=%d elements=%d requirements=%d', sections.length, elementCount, requirements.length);
    return requirements;
  }

  static getResponseValue(certificate, questionId) {
    const map = certificate?.responses;
    if (!map) return null;
    let r = null;
    if (typeof map.get === 'function') r = map.get(questionId);
    else if (typeof map === 'object') r = map[questionId];
    return r ?? null;
  }

  static hasResponse(certificate, questionId) {
    const map = certificate?.responses;
    if (!map) return false;
    if (typeof map.has === 'function') return map.has(questionId);
    if (typeof map === 'object') return Object.prototype.hasOwnProperty.call(map, questionId);
    return false;
  }

  static async meetsLevelRequirements(certificate, requirements, level) {
    // To achieve level L, all requirements with level <= L must be satisfied
    const levelRequirements = requirements.filter(r => r.level <= level);
    const failures = [];
    
    // Group requirements by question to handle choice requirements properly
    const requirementsByQuestion = new Map();
    for (const req of levelRequirements) {
      if (!requirementsByQuestion.has(req.questionId)) {
        requirementsByQuestion.set(req.questionId, []);
      }
      requirementsByQuestion.get(req.questionId).push(req);
    }
    
    for (const [questionId, questionRequirements] of requirementsByQuestion) {
      const actual = this.getResponseValue(certificate, questionId);
      
      // Check if this question has choice requirements
      const choiceRequirements = questionRequirements.filter(r => r.source === 'choice');
      const elementRequirements = questionRequirements.filter(r => r.source === 'element');
      
      if (choiceRequirements.length > 0) {
        // For questions with choice requirements, only check the choice that matches the actual answer
        const matchingChoiceReq = choiceRequirements.find(r => r.expectedValue === actual);
        
        if (matchingChoiceReq) {
          // Check the matching choice requirement
          const { expectedValue, condition, level: reqLevel } = matchingChoiceReq;
          
          // Check applicability first (visibility/condition). If not applicable, skip.
          if (condition && !this.evaluateCondition(certificate, condition)) {
            if (this.DEBUG) console.debug('[LevelCalc] skip choice requirement q=%s due to condition=%o', questionId, condition);
            continue;
          }
          
          // Special rule: if this choice requirement has level 0, it blocks all levels
          if (reqLevel === 0) {
            failures.push({ questionId, reason: 'blocking_choice', expected: expectedValue, actual, condition });
            continue;
          }
          
          // Choice requirement is satisfied (we found a matching choice)
          if (this.DEBUG) console.debug('[LevelCalc] choice requirement satisfied q=%s choice=%s level=%d', questionId, actual, reqLevel);
        } else {
          // No matching choice requirement found - this might be a problem
          if (this.DEBUG) console.debug('[LevelCalc] no matching choice requirement for q=%s answer=%s', questionId, actual);
        }
      }
      
      // Check element-level requirements (from requirements array)
      for (const requirement of elementRequirements) {
        const { expectedValue, condition, elementType, minChoiceLevel, choiceRequiredValues } = requirement;
        
        // Check applicability first (visibility/condition). If not applicable, skip.
        if (condition && !this.evaluateCondition(certificate, condition)) {
          if (this.DEBUG) console.debug('[LevelCalc] skip element requirement q=%s due to condition=%o', questionId, condition);
          continue;
        }
        
        // Special rule: for single-choice question with some choices having requirements, if the selected
        // choice has no requirement, then you cannot satisfy levels at or above the minimum choice level.
        if (elementType === 'radiogroup' && Array.isArray(choiceRequiredValues) && choiceRequiredValues.length) {
          const selected = actual;
          const selectedHasReq = choiceRequiredValues.includes(selected);
          if (!selectedHasReq) {
            // Block this element-level requirement by marking as mismatch
            failures.push({ questionId, reason: 'choice_without_requirement', expected: `one of ${JSON.stringify(choiceRequiredValues)}`, actual: selected, condition });
            continue;
          }
        }
        
        // Check expected or non-empty
        let ok;
        if (typeof expectedValue !== 'undefined') {
          // Allow for multi-select (checkbox) answers where actual is array
          if (Array.isArray(actual)) ok = actual.includes(expectedValue);
          else ok = (actual === expectedValue);
        } else {
          ok = (actual !== null && typeof actual !== 'undefined' && String(actual).length > 0);
        }
        if (!ok) failures.push({ questionId, reason: 'mismatch', expected: expectedValue, actual, condition });
      }
    }
    
    if (this.DEBUG && failures.length) {
      console.debug('[LevelCalc] level %d failures (%d/%d): %o', level, failures.length, levelRequirements.length, failures.slice(0, 10));
    }
    return failures.length === 0;
  }

  static async meetsRequirement(certificate, requirement) {
    const { questionId, expectedValue, condition } = requirement;
    if (!this.hasResponse(certificate, questionId)) {
      if (this.DEBUG) console.debug('[LevelCalc] meetsRequirement q=%s -> NO (missing response)', questionId);
      return false;
    }
    const value = this.getResponseValue(certificate, questionId);
    if (condition && !this.evaluateCondition(certificate, condition)) {
      if (this.DEBUG) console.debug('[LevelCalc] meetsRequirement n/a due to condition: q=%s value=%o cond=%o', questionId, value, condition);
      return true;
    }
    let ok;
    if (typeof expectedValue !== 'undefined') ok = (value === expectedValue);
    else ok = (value !== null && typeof value !== 'undefined' && String(value).length > 0);
    if (this.DEBUG) console.debug('[LevelCalc] meetsRequirement q=%s expected=%o value=%o -> %s', questionId, expectedValue, value, ok ? 'OK' : 'NO');
    return ok;
  }

  static async calculateLevelProgress(certificate, levelRequirements) {
    let total = 0, answered = 0, required = 0, answeredRequired = 0;
    for (const requirement of levelRequirements) {
      const { questionId, isRequired, condition } = requirement;
      if (condition && !this.evaluateCondition(certificate, condition)) continue;
      total += 1;
      if (isRequired) required += 1;
      if (this.hasResponse(certificate, questionId)) {
        const value = this.getResponseValue(certificate, questionId);
        if (value !== null && typeof value !== 'undefined' && String(value).length > 0) {
          answered += 1;
          if (isRequired) answeredRequired += 1;
        }
      }
    }
    return { total, answered, required, answeredRequired };
  }

  static evaluateCondition(certificate, condition) {
    // Accept either parsed object or raw SurveyJS visibleIf string
    if (!condition) return true;
    if (typeof condition === 'string') {
      // Very basic parser for expressions like "{var} = 'val'" with optional and/or
      try {
        const expr = condition.replace(/\bAND\b/gi, 'and').replace(/\bOR\b/gi, 'or');
        const tokens = expr.split(/\s+(and|or)\s+/i);
        let result = null;
        let pendingOp = null;
        for (let i = 0; i < tokens.length; i++) {
          const tok = tokens[i];
          if (tok.toLowerCase && (tok.toLowerCase() === 'and' || tok.toLowerCase() === 'or')) {
            pendingOp = tok.toLowerCase();
            continue;
          }
          const m = tok.match(/\{([^}]+)\}\s*([=!<>]+)\s*['"]([^'"]+)['"]/);
          let cur = false;
          if (m) {
            const varName = m[1];
            const op = m[2];
            const val = m[3];
            const has = this.hasResponse(certificate, varName);
            const actual = has ? this.getResponseValue(certificate, varName) : undefined;
            switch (op) {
              case '==': case '=': cur = (actual === val); break;
              case '!=': case '<>': cur = (actual !== val); break;
              default: cur = false; break;
            }
          }
          if (result === null) result = cur;
          else if (pendingOp === 'and') result = result && cur;
          else if (pendingOp === 'or') result = result || cur;
          pendingOp = null;
        }
        return result === null ? true : result;
      } catch (_) { return true; }
    }
    const { questionId, operator, value } = condition || {};
    if (!questionId) return true;
    if (!this.hasResponse(certificate, questionId)) return false;
    const responseValue = this.getResponseValue(certificate, questionId);
    switch (operator) {
      case '==': case '=': return responseValue === value;
      case '!=': case '<>': return responseValue !== value;
      case '>': return responseValue > value;
      case '<': return responseValue < value;
      case '>=': return responseValue >= value;
      case '<=': return responseValue <= value;
      case 'in': return Array.isArray(value) && value.includes(responseValue);
      case 'not_in': return Array.isArray(value) && !value.includes(responseValue);
      default: return false;
    }
  }

  static parseRequirementLevel(level, levelNames = []) {
    // Coerce numeric-like strings
    if (typeof level === 'number' || (typeof level === 'string' && /^\d+$/.test(level))) {
      const n = typeof level === 'number' ? level : Number(level);
      const max = Math.max(0, levelNames.length - 1);
      return Math.max(0, Math.min(max, n));
    }
    const idx = levelNames.findIndex(n => String(n || '').toLowerCase() === String(level || '').toLowerCase());
    if (idx >= 0) return idx;
    // Fallback common names
    const defaultMap = { none: 0, basic: 1, pilot: 2, standard: 3, exemplar: 4 };
    const key = String(level || '').toLowerCase();
    if (key in defaultMap) return defaultMap[key];
    return 0;
  }

  static getSurveyLevelMeta(survey) {
    // Use centralized level utilities
    const levelNames = getLevelNames(survey);
    const maxLevel = levelNames.length - 1;
    return { levelNames, maxLevel };
  }

  static parseCondition(visibleIf) {
    if (!visibleIf || typeof visibleIf !== 'string') return null;
    const m = visibleIf.match(/\{([^}]+)\}\s*([=!<>]+)\s*['"]([^'"]+)['"]/);
    if (m) return { questionId: m[1], operator: m[2], value: m[3] };
    return null;
  }
}

export default LevelCalculationService;
export { LevelCalculationService };