const mongoose = require('mongoose');

const loginEventSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  loginAt: { type: Date, default: Date.now, index: true },
  city: { type: String, default: '' },
  district: { type: String, default: '' },
  region: { type: String, default: '' },
  country: { type: String, default: '' },
  countryCode: { type: String, default: '' },
  timezone: { type: String, default: '' },
  ipHash: { type: String, default: '' },
  geoConsent: { type: Boolean, default: false },
  userAgent: { type: String, default: '' },
});

// Security login audits are automatically deleted after 90 days.
loginEventSchema.index({ loginAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

module.exports = mongoose.model('LoginEvent', loginEventSchema);
