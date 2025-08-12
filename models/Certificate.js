import mongoose from 'mongoose';

const certificateSchema = new mongoose.Schema({
  responseSetId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ResponseSet',
    required: true,
    unique: true
  },
  datasetId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Dataset',
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  name: {
    type: String,
    required: true
  },
  attainedLevel: {
    type: Number, // 0=none, 1=basic, 2=pilot, 3=standard, 4=exemplar
    default: 0,
    min: 0,
    max: 4
  },
  published: {
    type: Boolean,
    default: false
  },
  publishedAt: Date,
  expiresAt: Date,
  audited: {
    type: Boolean,
    default: false
  },
  state: {
    type: String,
    enum: ['draft', 'published'],
    default: 'draft'
  }
}, {
  timestamps: true
});

// Indexes
certificateSchema.index({ responseSetId: 1 }, { unique: true });
certificateSchema.index({ datasetId: 1 });
certificateSchema.index({ userId: 1 });
certificateSchema.index({ published: 1 });
certificateSchema.index({ attainedLevel: 1 });
certificateSchema.index({ expiresAt: 1 });

// Virtuals
certificateSchema.virtual('responseSet', {
  ref: 'ResponseSet',
  localField: 'responseSetId',
  foreignField: '_id',
  justOne: true
});

certificateSchema.virtual('dataset', {
  ref: 'Dataset',
  localField: 'datasetId',
  foreignField: '_id',
  justOne: true
});

certificateSchema.virtual('user', {
  ref: 'User',
  localField: 'userId',
  foreignField: '_id',
  justOne: true
});

// Instance methods
certificateSchema.methods.isVisible = function() {
  return this.published && this.dataset && !this.dataset.removed;
};

certificateSchema.methods.isExpired = function() {
  return this.expiresAt && this.expiresAt < new Date();
};

certificateSchema.methods.isExpiring = function() {
  if (!this.expiresAt) return false;
  const oneMonth = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds
  return this.expiresAt < new Date(Date.now() + oneMonth);
};

certificateSchema.methods.daysToExpiry = function() {
  if (!this.expiresAt) return null;
  const now = new Date();
  const diffTime = this.expiresAt - now;
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

certificateSchema.methods.getLevelName = function() {
  const levelNames = ['none', 'basic', 'pilot', 'standard', 'exemplar'];
  return levelNames[this.attainedLevel] || 'none';
};

certificateSchema.methods.setLevel = function(level) {
  if (typeof level === 'string') {
    const levelNames = ['none', 'basic', 'pilot', 'standard', 'exemplar'];
    this.attainedLevel = levelNames.indexOf(level);
  } else {
    this.attainedLevel = Math.max(0, Math.min(4, level));
  }
  return this;
};

certificateSchema.methods.publish = function() {
  this.published = true;
  this.publishedAt = new Date();
  this.state = 'published';
  return this;
};

certificateSchema.methods.unpublish = function() {
  this.published = false;
  this.publishedAt = null;
  this.state = 'draft';
  return this;
};

// Static methods
certificateSchema.statics.findPublished = function() {
  return this.find({ published: true });
};

certificateSchema.statics.findByLevel = function(level) {
  if (typeof level === 'string') {
    const levelNames = ['none', 'basic', 'pilot', 'standard', 'exemplar'];
    level = levelNames.indexOf(level);
  }
  return this.find({ attainedLevel: level });
};

certificateSchema.statics.findExpired = function() {
  return this.find({ expiresAt: { $lt: new Date() } });
};

certificateSchema.statics.findExpiring = function() {
  const oneMonth = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  return this.find({ 
    expiresAt: { 
      $lt: oneMonth,
      $gt: new Date()
    }
  });
};

// Ensure virtuals are serialized
certificateSchema.set('toJSON', { virtuals: true });
certificateSchema.set('toObject', { virtuals: true });

export default mongoose.model('Certificate', certificateSchema); 