// Load environment variables from .env file
import dotenv from 'dotenv';
dotenv.config({ path: './.env' });

import mysql from 'mysql2/promise';
import mongoose from 'mongoose';
import Survey from '../models/Survey.js';
import { pathToFileURL } from 'url';

class SurveyMigration {
  constructor(config) {
    this.mysqlConfig = config.mysql;
    this.mongoUrl = config.mongo;
    this.migrationLog = [];
    this.singleMode = config.singleMode || false;
    this.clearMongo = config.clearMongo || false;
    this.verbose = this.singleMode === true || config.verbose === true;
    this.mysqlConnection = null;
  }

  async connect() {
    try {
      this.mysqlConnection = await mysql.createConnection(this.mysqlConfig);
      await mongoose.connect(this.mongoUrl);
      if (this.verbose) {
        console.log('Connected to both databases');
        if (this.singleMode) {
          console.log('🔹 SINGLE MODE: Verbose logging enabled');
        }
      }
    } catch (error) {
      console.error('Connection error:', error);
      throw error;
    }
  }

  async disconnect() {
    try {
      if (this.mysqlConnection) {
        await this.mysqlConnection.end();
      }
      await mongoose.disconnect();
      if (this.verbose) {
        console.log('Disconnected from databases');
      }
    } catch (error) {
      console.error('Disconnection error:', error);
    }
  }

  async migrate() {
    if (this.verbose) {
      console.log('Starting survey migration...');
    }
    
    try {
      // Optionally clear existing survey data
      if (this.clearMongo) {
        if (this.verbose) {
          console.log('CLEAR_MONGO enabled: clearing existing MongoDB survey data...');
        }
        await Survey.deleteMany({});
      }

      if (this.singleMode) {
        const singleId = this.getSingleSurveyId() || 3252;
        console.log(`Single mode: importing only survey ID ${singleId}`);
        await this.migrateSurveysByIds([singleId]);
      } else {
        const surveyIds = await this.collectFullSurveyIds();
        await this.migrateSurveysByIds(surveyIds);
      }
      
      if (this.verbose) {
        console.log('Survey migration completed successfully!');
        this.printMigrationLog();
      }
      
    } catch (error) {
      console.error('Migration failed:', error);
      throw error;
    }
  }
  getSingleSurveyId() {
    const parseId = (val) => {
      if (val === undefined || val === null) return null;
      const num = Number(String(val).trim());
      return Number.isFinite(num) && num > 0 ? Math.trunc(num) : null;
    };

    // Prefer environment variables
    const fromEnv = parseId(process.env.SURVEY_ID) || parseId(process.env.SINGLE_SURVEY_ID);
    if (fromEnv) return fromEnv;

    // Parse CLI args: --id=123 or --survey-id=123
    const argv = Array.isArray(process.argv) ? process.argv.slice(2) : [];
    for (const arg of argv) {
      if (arg.startsWith('--id=')) {
        return parseId(arg.split('=')[1]);
      }
      if (arg.startsWith('--survey-id=')) {
        return parseId(arg.split('=')[1]);
      }
    }
    return null;
  }


  async clearMongoData() {
    console.log('Clearing existing MongoDB survey data...');
    await Survey.deleteMany({});
  }

  async migrateSurveysByIds(surveyIds) {
    // Filter to only those not already imported
    const toImport = [];
    for (const surveyId of surveyIds) {
      // eslint-disable-next-line no-await-in-loop
      const exists = await Survey.exists({ legacyId: surveyId });
      if (!exists) toImport.push(surveyId);
    }

    console.log(`Surveys to import: ${toImport.length}`);

    for (let index = 0; index < toImport.length; index += 1) {
      const surveyId = toImport[index];
      const prefix = `[${index + 1}/${toImport.length}]`;
      console.log(`${prefix} Importing survey ${surveyId}...`);
      try {
        // eslint-disable-next-line no-await-in-loop
        await this.migrateSingleSurvey(surveyId);
        console.log(`${prefix} Survey ${surveyId}: done`);
      } catch (error) {
        console.log(`${prefix} Survey ${surveyId}: failed - ${error?.message || 'unknown error'}`);
      }
    }
  }

  async migrateSingleSurvey(surveyId) {
    if (this.verbose) {
      console.log(`Migrating survey ID ${surveyId}...`);
    }
    
    // Get the specific survey
    const [surveyResult] = await this.mysqlConnection.execute(`
      SELECT id, access_code, title, full_title, description, status, survey_version, meta_map, created_at, updated_at
      FROM surveys 
      WHERE id = ?
    `, [surveyId]);
    
    if (surveyResult.length === 0) {
      console.error(`Survey ID ${surveyId} not found`);
      return;
    }

    const surveyRow = surveyResult[0];
    if (this.verbose) {
      console.log(`Found survey: ${surveyRow.title} (${surveyRow.access_code})`);
    }

    // Extract the complete survey structure
    const surveyStructure = await this.extractSurveyStructure(surveyRow.id);
    
      const originalFullTitle = surveyRow.full_title;
      const survey = new Survey({
      _id: new mongoose.Types.ObjectId(),
      legacyId: surveyRow.id,
        localle: surveyRow.access_code,
        localleText: originalFullTitle,
        title: 'Open Data Certificate',
        fullTitle: `Open Data Certificate ${originalFullTitle ? '- ' + originalFullTitle : ''}`,
      description: surveyRow.description,
      status: surveyRow.status,
      version: surveyRow.survey_version,
      metaMap: this.parseMetaMap(surveyRow.meta_map),
        sections: surveyStructure.sections,
        levels: new Map(Object.entries({
          0: {
            title: 'No level',
            description: 'No level has yet been achieved for this dataset',
            icon: 'images/badges/no_level_badge.png'
          },
          1: {
            title: 'Bronze',
            description: 'A fantastic start at the basics of publishing open data. It takes a lot to even get here.',
            icon: 'images/badges/raw_level_badge.png'
          },
          2: {
            title: 'Silver',
            description: 'Extra effort went in to support and encourage feedback from people who use this open data.',
            icon: 'images/badges/pilot_level_badge.png'
          },
          3: {
            title: 'Gold',
            description: 'Regularly published open data with robust support that people can rely on to build ever more ambitious projects and ventures on top of.',
            icon: 'images/badges/standard_level_badge.png'
          },
          4: {
            title: 'Platinum',
            description: 'This is above and beyond what’s expected - a fine example of information infrastructure for everyone else to aspire to.',
            icon: 'images/badges/exemplar_level_badge.png'
          }
        })),
      createdAt: surveyRow.created_at,
      updatedAt: surveyRow.updated_at
    });

    await survey.save();
    this.logMigration('Survey', surveyRow.id, survey._id);
    
    if (this.verbose) {
      console.log('Survey structure extracted and saved to MongoDB');
      console.log(`Survey has ${surveyStructure.sections.length} sections`);
    }
  }

  async collectFullSurveyIds() {
    const orderedIds = [];
    const seen = new Set();

    const addIds = (rows, key = 'id') => {
      for (const row of rows) {
        const id = row[key];
        if (id && !seen.has(id)) {
          seen.add(id);
          orderedIds.push(id);
        }
      }
    };

    // 1) Surveys with at least one published response set
    const [rsRows] = await this.mysqlConnection.execute(`
      SELECT 
        s.id
      FROM surveys s
      JOIN response_sets rs 
        ON s.id = rs.survey_id
        AND rs.aasm_state = 'published'
      GROUP BY s.id
    `);
    if (this.verbose) {
      console.log(`Identified ${rsRows.length} surveys with published response sets`);
    }
    addIds(rsRows, 'id');

    // 2) Surveys with published certificates (if not already included)
    const [certRows] = await this.mysqlConnection.execute(`
      SELECT 
        rs.survey_id AS survey_id
      FROM certificates c
      JOIN response_sets rs 
        ON c.response_set_id = rs.id
      WHERE c.aasm_state = 'published'
      GROUP BY rs.survey_id
      ORDER BY COUNT(*) DESC
    `);
    if (this.verbose) {
      console.log(`Identified ${certRows.length} surveys with published certificates`);
    }
    addIds(certRows, 'survey_id');

    // 3) Latest versions per title (locale) (if not already included)
    const [latestRows] = await this.mysqlConnection.execute(`
      SELECT s.id
      FROM surveys s
      INNER JOIN (
        SELECT title, MAX(survey_version) AS latest_version
        FROM surveys
        GROUP BY title
      ) m
        ON m.title = s.title AND m.latest_version = s.survey_version
    `);
    if (this.verbose) {
      console.log(`Identified ${latestRows.length} latest-version surveys by title`);
    }
    addIds(latestRows, 'id');

    return orderedIds;
  }

  async extractSurveyStructure(surveyId) {
    if (this.verbose) {
      console.log('Extracting survey structure...');
    }
    
    // Get survey sections
    const [sectionsResult] = await this.mysqlConnection.execute(`
      SELECT id, title, description, reference_identifier, display_order
      FROM survey_sections 
      WHERE survey_id = ?
      ORDER BY display_order
    `, [surveyId]);

    const sections = [];
    const surveyDefinition = {
      pages: [],
      elements: {}
    };

    for (const section of sectionsResult) {
      if (this.verbose) {
        console.log(`Processing section: ${section.title}`);
      }
      
       // Get questions for this section AND requirements text for this section
        const [questionsResult] = await this.mysqlConnection.execute(`
          SELECT id, text, short_text, help_text, reference_identifier, display_order, 
                 display_type, is_requirement, corresponding_requirements, required,
                 help_text_more_url, text_as_statement, display_on_certificate, pick,
                 answer_corresponding_to_requirement_id
         FROM questions 
         WHERE survey_section_id = ?
         ORDER BY display_order
       `, [section.id]);

      const sectionElements = [];
      // Buffer for iterative processing per your algorithm
      let pendingQuestion = null;
      let pendingAnswers = [];
      let pendingRequirementEntries = [];
      const questionNameById = {};

      const flushPending = async () => {
        if (!pendingQuestion) return;
        try {
          // Build visibleIf expression for this question based on dependencies
          const visibleIf = await this.buildVisibleIfExpression(pendingQuestion.id, questionNameById);
          const element = this.convertQuestionToJson(pendingQuestion, pendingAnswers, pendingRequirementEntries, visibleIf);
          if (element) {
            sectionElements.push(element);
          }
        } catch (error) {
          if (this.verbose) {
            console.error(`Error converting question ${pendingQuestion.id}:`, error);
            console.error('Question data:', pendingQuestion);
          }
        }
        pendingQuestion = null;
        pendingAnswers = [];
        pendingRequirementEntries = [];
      };

      for (const question of questionsResult) {
        if (this.verbose) {
          console.log(`  Processing question: ${question.reference_identifier || question.short_text}`);
          console.log(`    reference_identifier: ${question.reference_identifier}`);
          console.log(`    display_type: ${question.display_type}`);
          console.log(`    pick: ${question.pick}`);
          console.log(`    text: ${question.text?.substring(0, 50)}...`);
        }

        if (question.display_type === 'label') {
          // Attach requirement text to the previously buffered non-label question
          if (!pendingQuestion) {
            if (this.verbose) {
              console.warn('Label encountered without a pending question; skipping label.');
            }
            continue;
          }
          // Determine requirement id and level, capture clean text
          const candidateId = question.reference_identifier;
          const requirementId = this.isRequirementIdentifier(candidateId)
            ? candidateId
            : this.extractRequirementId(question.text || '');
          if (!requirementId) {
            continue;
          }
          const level = this.parseRequirementLevel(requirementId);
          const text = this.stripHtml(question.text || '').trim();
          const answerId = question.answer_corresponding_to_requirement_id || null;
          pendingRequirementEntries.push({ level, text, answerId });
          continue;
        }

        // Non-label question: flush any pending one before starting a new pending
        await flushPending();

        // Buffer this question and load choices if needed
        pendingQuestion = question;
        pendingAnswers = [];
        // Record element name for dependency resolution
        questionNameById[question.id] = this.getElementNameForQuestion(question);
        if (question.pick === 'one' || question.pick === 'any') {
          const [answers] = await this.mysqlConnection.execute(`
            SELECT id, text, short_text, help_text, reference_identifier, display_order,
                   weight, response_class, is_exclusive, display_type, input_type,
                   placeholder, text_as_statement
            FROM answers 
            WHERE question_id = ?
            ORDER BY display_order
          `, [question.id]);
          pendingAnswers = answers;
        }
      }

      // Flush the last buffered question in the section
      await flushPending();

       // Create section structure
       const sectionStructure = {
         name: section.reference_identifier || this.generateSectionName(section.title),
         title: section.title,
         description: section.description,
         elements: sectionElements // Store full element objects
       };

       sections.push(sectionStructure);
       surveyDefinition.pages.push(sectionStructure.name);
    }

    return {
      sections
    };
  }

  convertQuestionToJson(question, answers, requirementEntries, visibleIf) {
    // Prefer legacy reference_identifier as the element name; fallback to generated
    const elementName = (question.reference_identifier && typeof question.reference_identifier === 'string')
      ? question.reference_identifier
      : this.generateQuestionName(question.text || question.short_text);
    
    const element = {
      type: this.determineQuestionType(question, answers),
      name: elementName,
      title: {
        default: question.text || question.short_text
      }
    };
    // Display controls and statement titles for certificates
    const displayFlag = question.display_on_certificate;
    const displayOnCertificate = (
      displayFlag === true ||
      displayFlag === 1 ||
      displayFlag === '1' ||
      (typeof displayFlag === 'string' && displayFlag.toLowerCase() === 'true')
    );
    element.displayOnCertificate = !!displayOnCertificate;
    if (question.text_as_statement) {
      element.certificateTitle = {
        default: question.text_as_statement
      };
    }
    // Add visibleIf if present
    if (visibleIf && typeof visibleIf === 'string' && visibleIf.trim() !== '') {
      element.visibleIf = visibleIf;
    }

    // Debug logging for element name generation
    if (this.verbose) {
      console.log(`    Generated element name: ${elementName}`);
    }

    // Add description if available
    if (question.help_text) {
      element.description = {
        default: question.help_text
      };
    }

    // Add placeholder if available
    if (question.placeholder) {
      element.placeholder = {
        default: question.placeholder
      };
    }

    // Add input type for text questions
    if (element.type === 'text' && question.display_type) {
      element.inputType = question.display_type;
    }

    // Add required field
    if (question.required === 'required' || question.is_requirement) {
      element.isRequired = true;
    }

    // Aggregate requirements from labels into element.requirements (per-level texts)
    if (Array.isArray(requirementEntries) && requirementEntries.length > 0) {
      const byLevel = new Map();
      for (const re of requirementEntries) {
        if (!byLevel.has(re.level)) byLevel.set(re.level, []);
        byLevel.get(re.level).push(re.text);
      }
      const requirementsArr = Array.from(byLevel.entries()).sort((a,b)=>a[0]-b[0]).map(([level, texts]) => ({
        level,
        progressText: { default: (texts[texts.length - 1] || 'Complete this question to meet requirements') }
      }));
      if (requirementsArr.length) element.requirements = requirementsArr;
    }

    // Fallback: if this question is required in MySQL, ensure a Level 1 requirement exists
    // This guarantees the runtime level calculator can see baseline requirements
    if (!element.requirement && !element.requirements && (question.required === 'required')) {
      const baseText = this.stripHtml(question.text || question.short_text || '').trim();
      element.requirements = [{
        level: 1,
        progressText: { default: `You need to answer "${baseText || 'this question'}"` }
      }];
    }

    // Add choices for choice questions
    if (answers.length > 0 && (element.type === 'radiogroup' || element.type === 'checkbox')) {
      element.choices = answers.map(answer => {
        const choice = {
          value: answer.reference_identifier || answer.short_text || answer.text,
          text: answer.text || answer.short_text
        };
        if (answer.text_as_statement) {
          choice.statementText = { default: answer.text_as_statement };
        }
        // Attach requirement per choice if any label mapped to this answer id
        if (Array.isArray(requirementEntries) && requirementEntries.length) {
          const match = requirementEntries.find(re => re.answerId && Number(re.answerId) === Number(answer.id));
          if (match) {
            choice.requirement = {
              level: match.level,
              progressText: { default: match.text }
            };
          }
        }
        return choice;
      });
      
      // Special handling for publisherRights question: add choice requirements if not already present
      if (elementName === 'publisherRights' && element.type === 'radiogroup') {
        element.choices = element.choices.map(choice => {
          // Only add requirements if they don't already exist
          if (!choice.requirement) {
            switch (choice.value) {
              case 'yes':
                choice.requirement = {
                  level: 3,
                  progressText: { default: 'You should have a clear legal right to publish this data.' }
                };
                break;
              case 'no':
                choice.requirement = {
                  level: 0,
                  progressText: { default: 'You cannot publish this data as open data without the proper rights.' }
                };
                break;
              case 'unsure':
                choice.requirement = {
                  level: 1,
                  progressText: { default: 'You must clarify your rights to publish this data.' }
                };
                break;
              case 'complicated':
                choice.requirement = {
                  level: 1,
                  progressText: { default: 'You must clarify your rights to publish this data.' }
                };
                break;
            }
          }
          return choice;
        });
        
        // Also ensure the requirements array exists for element-level requirements
        if (!element.requirements) {
          element.requirements = [
            {
              level: 1,
              progressText: { default: 'You must have the right to publish this data.' }
            },
            {
              level: 3,
              progressText: { default: 'You should have a clear legal right to publish this data.' }
            }
          ];
        }
      }
    }

    return element;
  }

  determineQuestionType(question, answers) {
    // Determine question type based on pick field
    if (question.pick === 'one') {
      // Single choice question - use radiogroup
      return 'radiogroup';
    } else if (question.pick === 'any') {
      // Multiple choice question - use checkbox
      return 'checkbox';
    } else {
      // pick = 'none' or null - text input
      return 'text';
    }
  }

  generateQuestionName(text) {
    // Generate a name from question text
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, '_')
      .substring(0, 50);
  }

  generateSectionName(title) {
    // Generate a section name from title
    return title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, '_');
  }

  getElementNameForQuestion(question) {
    // Prefer legacy reference_identifier as the stable element name
    if (question && typeof question.reference_identifier === 'string' && question.reference_identifier.trim() !== '') {
      return question.reference_identifier;
    }
    return this.generateQuestionName(question.text || question.short_text);
  }

  async buildVisibleIfExpression(questionId, questionNameById) {
    try {
      // Fetch dependency for this question
      const [dependencies] = await this.mysqlConnection.execute(`
        SELECT id, rule
        FROM dependencies
        WHERE question_id = ?
        ORDER BY id DESC
        LIMIT 1
      `, [questionId]);

      if (!dependencies || dependencies.length === 0) return '';

      const dependency = dependencies[0];
      const dependencyId = dependency.id;
      let rule = (dependency.rule || '').trim();
      if (!rule) return '';

      // Fetch conditions for this dependency
      const [conditions] = await this.mysqlConnection.execute(`
        SELECT rule_key, question_id, operator, answer_id
        FROM dependency_conditions
        WHERE dependency_id = ?
        ORDER BY id
      `, [dependencyId]);

      if (!conditions || conditions.length === 0) return '';

      // Build a map from rule_key (A,B,...) to an expression like {var} = 'value'
      const keyToExpr = {};
      for (const cond of conditions) {
        // Resolve the variable name for the referenced question
        const depQuestionId = cond.question_id;
        let varName = questionNameById[depQuestionId];
        if (!varName) {
          // As a fallback, try to fetch minimal question text to name it
          const [qrows] = await this.mysqlConnection.execute(`
            SELECT reference_identifier, text, short_text
            FROM questions
            WHERE id = ?
            LIMIT 1
          `, [depQuestionId]);
          if (qrows && qrows.length > 0) {
            varName = qrows[0].reference_identifier || this.generateQuestionName(qrows[0].text || qrows[0].short_text);
          }
        }
        if (!varName) continue;

        // Resolve the expected answer value
        let valueLiteral = "''";
        if (cond.answer_id) {
          const [arows] = await this.mysqlConnection.execute(`
            SELECT reference_identifier, short_text, text
            FROM answers
            WHERE id = ?
            LIMIT 1
          `, [cond.answer_id]);
          if (arows && arows.length > 0) {
            const aref = arows[0].reference_identifier || arows[0].short_text || arows[0].text || '';
            valueLiteral = `'${String(aref).replace(/'/g, "\\'")}'`;
          }
        }

        // Map operator from legacy to visibleIf
        const op = (cond.operator || '==').trim();
        const operatorMap = {
          '==': '=',
          '=': '=',
          '!=': '!=',
          '<>': '!=',
          'in': 'contains',
          'not in': 'notcontains'
        };
        const visOp = operatorMap[op] || '=';

        // Build expression segment
        let expr;
        if (visOp === 'contains' || visOp === 'notcontains') {
          expr = `{${varName}} ${visOp} ${valueLiteral}`;
        } else {
          expr = `{${varName}} ${visOp} ${valueLiteral}`;
        }

        keyToExpr[cond.rule_key] = expr;
      }

      // Replace rule keys (A, B, C) in the rule with their expressions
      // Ensure keys are replaced as whole tokens
      let visibleIf = rule;
      const sortedKeys = Object.keys(keyToExpr).sort((a, b) => b.length - a.length);
      for (const k of sortedKeys) {
        const re = new RegExp(`(?<![A-Za-z0-9_])${k}(?![A-Za-z0-9_])`, 'g');
        visibleIf = visibleIf.replace(re, keyToExpr[k] || '');
      }

      // Normalize logical operators to lowercase 'and'/'or'
      visibleIf = visibleIf.replace(/\bAND\b/gi, 'and').replace(/\bOR\b/gi, 'or');

      // Clean excessive whitespace
      visibleIf = visibleIf.replace(/\s+/g, ' ').trim();

      return visibleIf;
    } catch (err) {
      console.warn('Error building visibleIf expression for question', questionId, err);
      return '';
    }
  }

  extractRequirementId(labelText) {
    // Extract requirement ID from label text like "You should <strong>provide contact information</strong> about your data to."
    // Look for patterns like basic_1, pilot_2, standard_22, exemplar_10
    const requirementPatterns = [
      /basic_\d+/,
      /pilot_\d+/,
      /standard_\d+/,
      /exemplar_\d+/
    ];
    
    for (const pattern of requirementPatterns) {
      const match = labelText.match(pattern);
      if (match) {
        return match[0];
      }
    }
    
    return null;
  }

  isRequirementIdentifier(identifier) {
    // Check if the identifier looks like a requirement identifier
    // Requirement identifiers typically follow patterns like: basic_1, pilot_2, standard_22, exemplar_10
    if (!identifier || typeof identifier !== 'string') {
      return false;
    }
    
    const requirementPatterns = [
      /^basic_\d+$/,
      /^pilot_\d+$/,
      /^standard_\d+$/,
      /^exemplar_\d+$/
    ];
    
    return requirementPatterns.some(pattern => pattern.test(identifier));
  }

  parseRequirements(requirementsString) {
    // Parse requirements string which might be JSON array or comma-separated
    let requirements = [];
    
    try {
      // Try to parse as JSON array
      if (typeof requirementsString === 'string') {
        requirements = JSON.parse(requirementsString);
      } else if (Array.isArray(requirementsString)) {
        requirements = requirementsString;
      }
    } catch (error) {
      // If JSON parsing fails, try comma-separated
      if (typeof requirementsString === 'string') {
        requirements = requirementsString.split(',').map(r => r.trim());
      }
    }
    
    // Find the highest level requirement
    let highestLevel = 1;
    let progressText = '';
    
    for (const req of requirements) {
      if (req.includes('basic')) {
        highestLevel = Math.max(highestLevel, 1);
        progressText = req;
      } else if (req.includes('pilot')) {
        highestLevel = Math.max(highestLevel, 2);
        progressText = req;
      } else if (req.includes('standard')) {
        highestLevel = Math.max(highestLevel, 3);
        progressText = req;
      } else if (req.includes('exemplar')) {
        highestLevel = Math.max(highestLevel, 4);
        progressText = req;
      }
    }
    
    return {
      level: highestLevel,
      progressText: progressText
    };
  }

  parseRequirementLevel(requirements) {
    // Parse requirement level from corresponding_requirements field
    // This is a simplified parser - you may need to enhance this
    if (requirements && typeof requirements === 'string') {
      const r = requirements.toLowerCase();
      if (r.includes('basic')) return 1;
      if (r.includes('pilot')) return 2;
      if (r.includes('standard')) return 3;
      if (r.includes('exemplar')) return 4;
    }
    return 1; // Default to basic
  }

  getQuestionRequirements(questionId, requirementMapping) {
    // Return array of entries: [{ level, text }]
    return requirementMapping[questionId] || [];
  }

  getHighestRequirementLevelFromEntries(entries) {
    // entries: [{ level, text }]
    let highestLevel = 1;
    for (const e of entries) {
      if (typeof e.level === 'number') {
        highestLevel = Math.max(highestLevel, e.level);
      }
    }
    return highestLevel;
  }

  getProgressTextForLevel(entries, targetLevel) {
    // Choose the text for the entry matching the target level; if multiple, take the last
    const matching = entries.filter(e => e.level === targetLevel);
    if (matching.length === 0) {
      // Fallback to any text
      return entries[entries.length - 1]?.text || '';
    }
    return matching[matching.length - 1].text || '';
  }

  stripHtml(html) {
    if (!html || typeof html !== 'string') return '';
    return html.replace(/<[^>]*>/g, '');
  }

  parseMetaMap(metaMapString) {
    // Parse meta_map field which might contain YAML or other formats
    if (!metaMapString) {
      return new Map();
    }

    try {
      // If it's already a valid JSON object, return it
      if (typeof metaMapString === 'object') {
        return new Map(Object.entries(metaMapString));
      }

      // If it's a string, try to parse it
      if (typeof metaMapString === 'string') {
        // Remove YAML markers if present
        const cleanString = metaMapString.replace(/^---\s*/, '').replace(/\s*$/, '');
        
        if (cleanString === '{}' || cleanString === '') {
          return new Map();
        }

        // Try to parse as JSON
        try {
          const parsed = JSON.parse(cleanString);
          return new Map(Object.entries(parsed));
        } catch (jsonError) {
          // If JSON parsing fails, return empty map
          console.warn('Could not parse meta_map as JSON, using empty map:', metaMapString);
          return new Map();
        }
      }

      return new Map();
    } catch (error) {
      console.warn('Error parsing meta_map, using empty map:', error);
      return new Map();
    }
  }

  logMigration(type, rubyId, mongoId) {
    this.migrationLog.push({
      type,
      rubyId,
      mongoId: mongoId.toString(),
      timestamp: new Date()
    });
  }

  printMigrationLog() {
    console.log('\nMigration Summary:');
    console.log('==================');
    
    const summary = {};
    for (const log of this.migrationLog) {
      summary[log.type] = (summary[log.type] || 0) + 1;
    }
    
    for (const [type, count] of Object.entries(summary)) {
      console.log(`${type}: ${count} records migrated`);
    }
    
    console.log(`\nTotal records migrated: ${this.migrationLog.length}`);
    
    if (this.singleMode) {
      console.log('\n🔹 SINGLE MODE: Single survey import completed');
    }
  }
}

// Migration configuration
const config = {
  mysql: {
    host: process.env.MYSQL_HOST || 'localhost',
    port: process.env.MYSQL_PORT || 3306,
    database: process.env.MYSQL_DATABASE || 'open_data_certificate',
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    charset: 'utf8mb4'
  },
  mongo: process.env.MONGO_URL || 'mongodb://localhost:27017/open_data_certificate',
  singleMode: process.env.SINGLE_MODE === 'true',
  clearMongo: process.env.CLEAR_MONGO === 'true',
  verbose: process.env.VERBOSE === 'true' || process.env.SINGLE_MODE === 'true'
};

// Debug: Log environment variables (without sensitive data)
if (config.verbose) { 
  console.log('Environment variables loaded:');
  console.log('MYSQL_HOST:', process.env.MYSQL_HOST || 'not set');
  console.log('MYSQL_PORT:', process.env.MYSQL_PORT || 'not set');
  console.log('MYSQL_DATABASE:', process.env.MYSQL_DATABASE || 'not set');
  console.log('MYSQL_USER:', process.env.MYSQL_USER || 'not set');
  console.log('MYSQL_PASSWORD:', process.env.MYSQL_PASSWORD ? '[SET]' : 'not set');
  console.log('MONGO_URL:', process.env.MONGO_URL || 'not set');
  console.log('SINGLE_MODE:', process.env.SINGLE_MODE || 'not set');
  console.log('SINGLE_SURVEY_ID:', process.env.SINGLE_SURVEY_ID || 'not set');
  console.log('CLEAR_MONGO:', process.env.CLEAR_MONGO || 'not set');
  console.log('');
}
// Run migration if called directly (ESM-safe)
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const migration = new SurveyMigration(config);
  
  migration.connect()
    .then(() => migration.migrate())
    .then(() => migration.disconnect())
    .catch(error => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

export default SurveyMigration; 