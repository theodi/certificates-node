import mongoose from 'mongoose';
import { getLevelName } from '../utils/levels.js';

const certificateSchema = new mongoose.Schema({
  legacyId: {
    type: Number,
    index: true
  },
  datasetId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Dataset',
    required: true
  },
  // Legacy dataset identifier from the Ruby system
  legacyDatasetId: {
    type: Number,
    index: true
  },
  // Legacy certificate identifier from the Ruby system, used to preserve URLs
  legacyResponseSetId: {
    type: Number,
    index: true
  },
  surveyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Survey',
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  state: {
    type: String,
    enum: ['draft', 'published', 'archived', 'superseded'],
    default: 'draft'
  },
  locale: {
    type: String,
    default: 'en'
  },
  responses: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: new Map()
  },
  attainedLevel: {
    type: Number, // 0=none, 1=basic, 2=pilot, 3=standard, 4=exemplar
    default: 0,
    min: 0,
    max: 4
  },
  attainedIndex: {
    type: Number,
    default: 0
  },
  missingResponses: {
    type: String,
    default: ''
  },
  accessCode: {
    type: String,
    required: true
  }
}, {
  timestamps: true
});

// Indexes
certificateSchema.index({ datasetId: 1, createdAt: -1 });
certificateSchema.index({ userId: 1, createdAt: -1 });
certificateSchema.index({ surveyId: 1 });
certificateSchema.index({ state: 1 });
certificateSchema.index({ accessCode: 1 });
certificateSchema.index({ legacyId: 1 }, { sparse: true });

// Virtual for certificate
certificateSchema.virtual('certificate', {
  ref: 'Certificate',
  localField: '_id',
  foreignField: 'responseSetId',
  justOne: true
});

// Instance methods
certificateSchema.methods.getResponse = function(questionIdentifier) {
  return this.responses.get(questionIdentifier);
};

certificateSchema.methods.setResponse = function(questionIdentifier, value) {
  this.responses.set(questionIdentifier, value);
  return this;
};

certificateSchema.methods.hasResponse = function(questionIdentifier) {
  return this.responses.has(questionIdentifier);
};

certificateSchema.methods.getResponseValue = function(questionIdentifier) {
  return this.responses.get(questionIdentifier);
};

certificateSchema.methods.isComplete = function() {
  return this.state === 'published' || this.state === 'archived';
};

certificateSchema.methods.isPublished = function() {
  return this.state === 'published';
};

certificateSchema.methods.canModify = function() {
  return this.state === 'draft';
};

certificateSchema.methods.setLevel = function(level) {
  this.attainedLevel = Math.max(0, Math.min(4, level));
};

certificateSchema.methods.getLevelName = async function() {
  // Fetch the survey to get proper level names
  const Survey = mongoose.model('Survey');
  const survey = await Survey.findById(this.surveyId).select('levels').lean();
  return getLevelName(survey, this.attainedLevel);
};

// Static methods
certificateSchema.statics.findByDataset = function(datasetId) {
  return this.find({ datasetId }).sort({ createdAt: -1 });
};

certificateSchema.statics.findPublished = function() {
  return this.find({ state: 'published' });
};

certificateSchema.statics.findByUser = function(userId) {
  return this.find({ userId }).sort({ createdAt: -1 });
};

// Ensure virtuals are serialized
certificateSchema.set('toJSON', { virtuals: true });
certificateSchema.set('toObject', { virtuals: true });

export default mongoose.model('Certificate', certificateSchema);