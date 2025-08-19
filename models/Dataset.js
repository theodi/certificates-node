import mongoose from 'mongoose';

const datasetSchema = new mongoose.Schema({
  legacyId: {
    type: Number,
    index: true,
    required: false
  },
  title: {
    type: String,
    required: true
  },
  url: {
    type: String,
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  managerUserIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  }],
  removed: {
    type: Boolean,
    default: false
  },
  createdAt: {
      type: Date,
      default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes
datasetSchema.index({ legacyId: 1 }, { unique: true, sparse: true });
datasetSchema.index({ userId: 1, createdAt: -1 });
datasetSchema.index({ managerUserIds: 1 });
datasetSchema.index({ url: 1 });
datasetSchema.index({ removed: 1 });

// Virtual for latest response set
datasetSchema.virtual('latestCertificate', {
  ref: 'Certificate',
  localField: '_id',
  foreignField: 'datasetId',
  justOne: true,
  options: { sort: { createdAt: -1 } }
});

// Virtual for published certificate
datasetSchema.virtual('publishedCertificate', {
  ref: 'Certificate',
  localField: '_id',
  foreignField: 'datasetId',
  justOne: true,
  match: { published: true }
});

// Instance methods
datasetSchema.methods.isVisible = function() {
  return !this.removed && this.publishedCertificate;
};

datasetSchema.methods.getNewestCertificate = function() {
  return this.model('Certificate')
    .findOne({ datasetId: this._id })
    .sort({ createdAt: -1 });
};

datasetSchema.methods.getNewestCompletedCertificate = function() {
  return this.model('Certificate')
    .findOne({ 
      datasetId: this._id,
      state: { $in: ['published', 'archived'] }
    })
    .sort({ createdAt: -1 });
};

// Ensure virtuals are serialized
datasetSchema.set('toJSON', { virtuals: true });
datasetSchema.set('toObject', { virtuals: true });

export default mongoose.model('Dataset', datasetSchema);