const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  canonicalKey: { type: String, required: true, unique: true },
  competitionKey: { type: String, required: true },
  kickoff: { type: Date, required: true },
  home: { type: String, required: true },
  away: { type: String, required: true },
  providerIds: { type: mongoose.Schema.Types.Mixed, default: {} },
  providerTeamIds: { type: mongoose.Schema.Types.Mixed, default: {} },
  updatedAt: { type: Date, default: Date.now }
});
schema.index({ updatedAt: 1 }, { expireAfterSeconds: 45 * 24 * 3600 });
module.exports = mongoose.models.ProviderIdentity || mongoose.model('ProviderIdentity', schema);
