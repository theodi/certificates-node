import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  name: {
    type: String,
    required: true
  },
  shortName: String,
  organization: String,
  defaultJurisdiction: {
    type: String,
    default: 'gb'
  },
  preferredLocale: {
    type: String,
    default: 'en'
  },
  admin: {
    type: Boolean,
    default: false
  },
  signInCount: {
    type: Number,
    default: 0
  },
  lastLogin: Date,
}, {
  timestamps: true
});

// Indexes
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ admin: 1 });

// Virtuals
userSchema.virtual('datasets', {
  ref: 'Dataset',
  localField: '_id',
  foreignField: 'userId'
});

userSchema.virtual('certificates', {
  ref: 'Certificate',
  localField: '_id',
  foreignField: 'userId'
});

// Instance methods
userSchema.methods.isAdmin = function() {
  return this.admin === true;
};

userSchema.methods.getDisplayName = function() {
  return this.shortName || this.name;
};

userSchema.methods.getDatasets = function() {
  return this.model('Dataset').find({ userId: this._id });
};

userSchema.methods.getCertificates = function() {
  return this.model('Certificate').find({ userId: this._id });
};

userSchema.methods.getPublishedCertificates = function() {
  return this.model('Certificate').find({ 
    userId: this._id, 
    published: true 
  });
};

// Static methods
userSchema.statics.findByEmail = function(email) {
  return this.findOne({ email: email.toLowerCase() });
};

userSchema.statics.findAdmins = function() {
  return this.find({ admin: true });
};

export default mongoose.model('User', userSchema);