// Load environment variables from .env file
import dotenv from 'dotenv';
dotenv.config({ path: './.env' });

import mysql from 'mysql2/promise';
import mongoose from 'mongoose';
import User from '../models/User.js';
import ResponseSet from '../models/ResponseSet.js';
import Survey from '../models/Survey.js';
import Dataset from '../models/Dataset.js';
import { pathToFileURL } from 'url';

class CertificateMigration {
  constructor(config) {
    this.mysqlConfig = config.mysql;
    this.mongoUrl = config.mongo;
    this.migrationLog = [];
    this.singleMode = config.singleMode || false;
    this.verbose = config.verbose === true || this.singleMode === true;
    this.mysqlConnection = null;
  }

  async connect() {
    this.mysqlConnection = await mysql.createConnection(this.mysqlConfig);
    await mongoose.connect(this.mongoUrl);
    if (this.verbose) {
      console.log('Connected to both databases');
      if (this.singleMode) console.log('🔹 SINGLE MODE: Verbose logging enabled');
    }
  }

  async disconnect() {
    if (this.mysqlConnection) await this.mysqlConnection.end();
    await mongoose.disconnect();
  }

  async migrate() {
    if (this.singleMode) {
      const datasetId = this.getSingleDatasetId() || 220763;
      console.log(`Single mode: migrating dataset ${datasetId}`);
      await this.migrateDatasetsByIds([datasetId]);
    } else {
      console.log('Full mode: migrating datasets with published certificates');
      const datasetIds = await this.collectDatasetIdsForFullMigration();
      await this.migrateDatasetsByIds(datasetIds);
    }
  }

  getSingleDatasetId() {
    const parseId = (v) => {
      if (v === undefined || v === null) return null;
      const n = Number(String(v).trim());
      return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
    };
    const env = parseId(process.env.DATASET_ID) || parseId(process.env.SINGLE_DATASET_ID);
    if (env) return env;
    const argv = process.argv.slice(2);
    for (const a of argv) {
      if (a.startsWith('--dataset-id=')) return parseId(a.split('=')[1]);
      if (a.startsWith('--id=')) return parseId(a.split('=')[1]);
    }
    return null;
  }

  async collectDatasetIdsForFullMigration() {
    const [rows] = await this.mysqlConnection.execute(`
      SELECT DISTINCT rs.dataset_id AS dataset_id
      FROM certificates c
      JOIN response_sets rs ON c.response_set_id = rs.id
      WHERE c.aasm_state = 'published' AND rs.dataset_id IS NOT NULL
      ORDER BY rs.dataset_id
    `);
    return rows.map(r => r.dataset_id).filter(Boolean);
  }

  async migrateDatasetsByIds(datasetIds) {
    console.log(`Datasets to migrate: ${datasetIds.length}`);
    for (let i = 0; i < datasetIds.length; i += 1) {
      const datasetId = datasetIds[i];
      const prefix = `[${i + 1}/${datasetIds.length}]`;
      console.log(`${prefix} Migrating dataset ${datasetId}...`);
      try {
        // eslint-disable-next-line no-await-in-loop
        await this.migrateSingleDataset(datasetId);
        console.log(`${prefix} Dataset ${datasetId}: done`);
      } catch (err) {
        console.log(`${prefix} Dataset ${datasetId}: failed - ${err?.message || 'unknown error'}`);
      }
    }
  }

  async migrateSingleDataset(legacyDatasetId) {
    // 1) Load dataset from legacy DB
    const [dsRows] = await this.mysqlConnection.execute(`
      SELECT id, title, documentation_url, user_id, removed, created_at, updated_at
      FROM datasets
      WHERE id = ?
    `, [legacyDatasetId]);
    if (!dsRows || dsRows.length === 0) {
      throw new Error(`Dataset ${legacyDatasetId} not found`);
    }
    const ds = dsRows[0];

    // 2) Ensure owner user exists in Mongo
    const ownerUserId = await this.ensureUser(ds.user_id);

    // 3) Find or create Dataset doc in Mongo (documentation_url -> url)
    const datasetUrl = ds.documentation_url;
    let datasetDoc = await Dataset.findOne({ legacyId: legacyDatasetId });
    if (!datasetDoc) {
      datasetDoc = await Dataset.create({
        title: ds.title || datasetUrl || `Dataset ${legacyDatasetId}`,
        url: datasetUrl,
        legacyId: legacyDatasetId,
        userId: ownerUserId,
        removed: !!ds.removed,
        createdAt: ds.created_at,
        updatedAt: ds.updated_at
      });
    }

    // 4) Load all response sets for this dataset
    const [rsList] = await this.mysqlConnection.execute(`
      SELECT rs.id, rs.user_id, rs.survey_id, rs.dataset_id, rs.access_code,
             rs.aasm_state, rs.attained_index, rs.missing_responses,
             rs.created_at, rs.updated_at
      FROM response_sets rs
      WHERE rs.dataset_id = ?
      ORDER BY rs.created_at ASC
    `, [legacyDatasetId]);

    for (const row of rsList) {
      // Skip if already imported by legacy response set id
      const already = await ResponseSet.exists({ legacyId: row.id });
      if (already) {
        if (this.verbose) console.log(`  Skipping response set ${row.id}: already imported`);
        continue;
      }
      // Ensure user for this response set
      const rsUserId = await this.ensureUser(row.user_id);

      // Fetch legacy certificate id for URL preservation
      let legacyCertificateId = null;
      const [certRows] = await this.mysqlConnection.execute(
        `SELECT id FROM certificates WHERE response_set_id = ? LIMIT 1`,
        [row.id]
      );
      if (certRows && certRows.length) {
        legacyCertificateId = certRows[0].id;
      }

      // Build a quick map of element types from the imported survey
      const surveyDoc = await Survey.findOne({ legacyId: row.survey_id }).select('_id sections').lean();
      const elementTypeByName = {};
      if (surveyDoc && Array.isArray(surveyDoc.sections)) {
        for (const section of surveyDoc.sections) {
          for (const el of (section.elements || [])) {
            if (el && el.name) elementTypeByName[el.name] = el.type || 'text';
          }
        }
      }

      // Get responses for this response set
      const [responsesResult] = await this.mysqlConnection.execute(`
        SELECT r.question_id, r.answer_id, r.text_value, r.string_value, 
               r.integer_value, r.float_value, r.datetime_value, r.explanation,
               r.autocompleted, r.error, q.reference_identifier
        FROM responses r
        JOIN questions q ON r.question_id = q.id
        WHERE r.response_set_id = ?
      `, [row.id]);

      const responses = new Map();
      for (const responseRow of responsesResult) {
        if (!responseRow.reference_identifier) continue;
        const elementName = responseRow.reference_identifier;
        const elementType = elementTypeByName[elementName] || 'text';

        let value = null;
        let valueType = null;
        if (responseRow.text_value != null) { value = responseRow.text_value; valueType = 'text'; }
        else if (responseRow.string_value != null) { value = responseRow.string_value; valueType = 'string'; }
        else if (responseRow.integer_value != null) { value = responseRow.integer_value; valueType = 'integer'; }
        else if (responseRow.float_value != null) { value = responseRow.float_value; valueType = 'float'; }
        else if (responseRow.datetime_value != null) { value = responseRow.datetime_value; valueType = 'datetime'; }

        let choiceRef = null;
        if (value === null && responseRow.answer_id) {
          const [ans] = await this.mysqlConnection.execute(
            `SELECT reference_identifier, short_text, text FROM answers WHERE id = ? LIMIT 1`,
            [responseRow.answer_id]
          );
          if (ans && ans.length) {
            choiceRef = ans[0].reference_identifier || ans[0].short_text || ans[0].text || null;
            value = choiceRef;
            valueType = 'choice';
          }
        }

        // Aggregate for multi-select (checkbox) questions
        if (elementType === 'checkbox') {
          const existing = responses.get(elementName);
          const nextArray = Array.isArray(existing?.value) ? existing.value.slice() : (existing ? [existing.value] : []);
          if (value !== null && typeof value !== 'undefined') nextArray.push(value);
          responses.set(elementName, {
            value: nextArray,
            valueType: 'choice[]',
            explanation: responseRow.explanation,
            autocompleted: responseRow.autocompleted || false,
            error: responseRow.error || false
          });
        } else if (elementType === 'text') {
          // Some text questions can have multiple responses; convert to array if repeated
          const existing = responses.get(elementName);
          if (existing) {
            const nextArray = Array.isArray(existing.value)
              ? existing.value.slice()
              : (typeof existing.value !== 'undefined' && existing.value !== null
                  ? [existing.value]
                  : []);
            if (value !== null && typeof value !== 'undefined') nextArray.push(value);
            responses.set(elementName, {
              value: nextArray,
              valueType: 'text[]',
              explanation: responseRow.explanation,
              autocompleted: responseRow.autocompleted || false,
              error: responseRow.error || false
            });
          } else {
            responses.set(elementName, {
              value,
              valueType,
              choiceRef,
              explanation: responseRow.explanation,
              autocompleted: responseRow.autocompleted || false,
              error: responseRow.error || false
            });
          }
        } else {
          responses.set(elementName, {
            value,
            valueType,
            choiceRef,
            explanation: responseRow.explanation,
            autocompleted: responseRow.autocompleted || false,
            error: responseRow.error || false
          });
        }
      }

      const responseSet = new ResponseSet({
        _id: new mongoose.Types.ObjectId(),
        legacyId: row.id,
        datasetId: datasetDoc._id,
        legacyDatasetId: legacyDatasetId,
        surveyId: surveyDoc ? surveyDoc._id : null,
        userId: rsUserId,
        state: this.mapState(row.aasm_state),
        certificateId: legacyCertificateId,
        responses: responses,
        attainedLevel: this.mapLevel(row.attained_index),
        attainedIndex: row.attained_index || 0,
        missingResponses: row.missing_responses || '',
        accessCode: row.access_code,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      });

      await responseSet.save();
      this.logMigration('ResponseSet', row.id, responseSet._id);
    }
  }

  mapState(rubyState) {
    const stateMap = {
      'draft': 'draft',
      'published': 'published',
      'archived': 'archived',
      'superseded': 'superseded'
    };
    return stateMap[rubyState] || 'draft';
  }

  mapLevel(rubyLevel) {
    const levelMap = {
      'none': 0,
      'basic': 1,
      'pilot': 2,
      'standard': 3,
      'exemplar': 4
    };
    
    if (typeof rubyLevel === 'number') {
      return Math.max(0, Math.min(4, rubyLevel));
    }
    
    return levelMap[rubyLevel] || 0;
  }

  // helper moved: ensureUser below

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
  console.log('SINGLE_DATASET_ID:', process.env.SINGLE_DATASET_ID || 'not set');
  console.log('');
}

// Helper to ensure a user exists
CertificateMigration.prototype.ensureUser = async function ensureUser(legacyUserId) {
  if (!legacyUserId) return null;
  const [userRows] = await this.mysqlConnection.execute(`
    SELECT id, email, name, sign_in_count, last_sign_in_at, created_at
    FROM users
    WHERE id = ?
  `, [legacyUserId]);
  if (!userRows || userRows.length === 0) return null;
  const ur = userRows[0];
  let userDoc = await User.findOne({ email: ur.email });
  if (!userDoc) {
    userDoc = await User.create({
      email: ur.email,
      name: ur.name || ur.email,
      signInCount: ur.sign_in_count || 0,
      lastLogin: ur.last_sign_in_at,
      createdAt: ur.created_at,
      updatedAt: ur.created_at
    });
  }
  return userDoc._id;
};

// Run migration if called directly (ESM-safe)
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const migration = new CertificateMigration(config);
  
  migration.connect()
    .then(() => migration.migrate())
    .then(() => migration.disconnect())
    .catch(error => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

export default CertificateMigration; 