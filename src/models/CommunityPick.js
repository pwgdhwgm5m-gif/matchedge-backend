const mongoose = require('mongoose');

const communityPickSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  fixtureId: { type: String, required: true, index: true },
  canonicalFixtureKey: { type: String },
  homeTeam: { type: String, required: true },
  awayTeam: { type: String, required: true },
  league: { type: String, default: '' },
  kickoff: { type: Date, default: null },
  canonicalProvider: { type: String, enum: ['sportmonks','bsd','sportsdb',null], default: null },
  providerIds: { type: mongoose.Schema.Types.Mixed, default: {} },
  key: { type: String, required: true },
  market: { type: String, required: true },
  label: { type: String, required: true },
  result: { type: String, enum: ['pending','won','lost','void'], default: 'pending' },
  settledAt: { type: Date, default: null },
  verified: { type: Boolean, default: false, index: true },
  lockedAt: { type: Date, default: null },
  source: { type: String, enum: ['analysis','match-room','legacy'], default: 'legacy' },
}, { timestamps: true });
communityPickSchema.index(
  { userId: 1, canonicalFixtureKey: 1, key: 1 },
  { unique: true, partialFilterExpression: { canonicalFixtureKey: { $type: 'string' } } }
);
communityPickSchema.index({ fixtureId: 1, key: 1 });
communityPickSchema.index({ verified: 1, result: 1, kickoff: 1 });
module.exports = mongoose.model('CommunityPick', communityPickSchema);
