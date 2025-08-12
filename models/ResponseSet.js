import mongoose from 'mongoose';

const responseSchema = new mongoose.Schema({
  // Unified value captured from legacy typed columns or from choice answer ref
  value: mongoose.Schema.Types.Mixed,
  valueType: {
    type: String, // one of: text|string|integer|float|datetime|choice|null
  },
  // For choice questions, the chosen answer's reference_identifier (or text fallback)
  choiceRef: String,
  explanation: String, // For URL validation failures
  autocompleted: {
    type: Boolean,
    default: false
  },
  error: {
    type: Boolean,
    default: false
  }
}, { _id: false });

const responseSetSchema = new mongoose.Schema({
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
  certificateId: {
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
    of: responseSchema,
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
responseSetSchema.index({ datasetId: 1, createdAt: -1 });
responseSetSchema.index({ userId: 1, createdAt: -1 });
responseSetSchema.index({ surveyId: 1 });
responseSetSchema.index({ state: 1 });
responseSetSchema.index({ accessCode: 1 });
responseSetSchema.index({ legacyId: 1 }, { sparse: true });

// Virtual for certificate
responseSetSchema.virtual('certificate', {
  ref: 'Certificate',
  localField: '_id',
  foreignField: 'responseSetId',
  justOne: true
});

// Instance methods
responseSetSchema.methods.getResponse = function(questionIdentifier) {
  return this.responses.get(questionIdentifier);
};

responseSetSchema.methods.setResponse = function(questionIdentifier, responseData) {
  this.responses.set(questionIdentifier, responseData);
  return this;
};

responseSetSchema.methods.hasResponse = function(questionIdentifier) {
  return this.responses.has(questionIdentifier);
};

responseSetSchema.methods.getResponseValue = function(questionIdentifier) {
  const response = this.getResponse(questionIdentifier);
  if (!response) return null;
  // Prefer unified value; fallback to legacy fields if present
  if (typeof response.value !== 'undefined') return response.value;
  return response.textValue || response.stringValue || response.integerValue ||
         response.floatValue || response.datetimeValue || response.choiceRef || null;
};

responseSetSchema.methods.isComplete = function() {
  return this.state === 'published' || this.state === 'archived';
};

responseSetSchema.methods.isPublished = function() {
  return this.state === 'published';
};

responseSetSchema.methods.canModify = function() {
  return this.state === 'draft';
};

responseSetSchema.methods.getLevelName = function() {
  const levelNames = ['none', 'basic', 'pilot', 'standard', 'exemplar'];
  return levelNames[this.attainedLevel] || 'none';
};

responseSetSchema.methods.setLevel = function(level) {
  if (typeof level === 'string') {
    const levelNames = ['none', 'basic', 'pilot', 'standard', 'exemplar'];
    this.attainedLevel = levelNames.indexOf(level);
  } else {
    this.attainedLevel = Math.max(0, Math.min(4, level));
  }
  this.attainedIndex = this.attainedLevel;
  return this;
};

// Static methods
responseSetSchema.statics.findByDataset = function(datasetId) {
  return this.find({ datasetId }).sort({ createdAt: -1 });
};

responseSetSchema.statics.findPublished = function() {
  return this.find({ state: 'published' });
};

responseSetSchema.statics.findByUser = function(userId) {
  return this.find({ userId }).sort({ createdAt: -1 });
};

// Ensure virtuals are serialized
responseSetSchema.set('toJSON', { virtuals: true });
responseSetSchema.set('toObject', { virtuals: true });

export default mongoose.model('ResponseSet', responseSetSchema);