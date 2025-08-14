import mongoose from 'mongoose';

const surveySchema = new mongoose.Schema({
  legacyId: {
    type: Number,
    index: true
  },
  localle: {
    type: String,
    required: true,
    index: true
  },
  localleText: String,
  title: {
    type: String,
    required: true
  },
  fullTitle: String,
  description: String,
  status: {
    type: String,
    enum: ['alpha', 'beta', 'final'],
    default: 'alpha'
  },
  version: {
    type: Number,
    default: 1
  },
  sections: [{
    name: String,
    title: String,
    description: String,
    elements: [Object] // Full element definitions embedded directly
  }],
  metaMap: {
    type: Map,
    of: String,
    default: new Map()
  },
  levels: {
    type: Map,
    of: new mongoose.Schema({
      title: { type: String },
      description: { type: String },
      icon: { type: String }
    }, { _id: false }),
    default: new Map()
  }
}, {
  timestamps: true
});

// Indexes for efficient querying
surveySchema.index({ localle: 1, version: -1 });
surveySchema.index({ status: 1 });

// Static methods
surveySchema.statics.findByJurisdiction = function(localle) {
  return this.findOne({ localle, status: { $ne: 'alpha' } })
    .sort({ version: -1 });
};

surveySchema.statics.findAvailable = function() {
  return this.find({ status: { $ne: 'alpha' } })
    .sort({ fullTitle: 1, version: -1 })
    .distinct('accessCode');
};

// Instance methods
surveySchema.methods.getLevelNames = function() {
  // Convert levels Map to array of level names in order
  const levelEntries = Array.from(this.levels.entries());
  // Sort by key (assuming keys are numeric strings like "0", "1", "2", etc.)
  levelEntries.sort((a, b) => parseInt(a[0]) - parseInt(b[0]));
  return levelEntries.map(([key, level]) => level.title || key);
};

surveySchema.methods.getLevelName = function(index) {
  const level = this.levels.get(String(index));
  return level?.title || String(index);
};

surveySchema.methods.getLevelDescription = function(index) {
  const level = this.levels.get(String(index));
  return level?.description || '';
};

surveySchema.methods.getLevelIcon = function(index) {
  const level = this.levels.get(String(index));
  return level?.icon || '';
};

surveySchema.methods.getLevelCount = function() {
  return this.levels.size;
};

export default mongoose.model('Survey', surveySchema);