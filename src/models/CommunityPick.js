const mongoose = require('mongoose');

const communityPickSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  fixtureId: { type: String, required: true, index: true },
  homeTeam: { type: String, required: true },
  awayTeam: { type: String, required: true },
  league: { type: String, default: '' },
  kickoff: { type: Date, default: null },
  key: { type: String, required: true },
  market: { type: String, required: true },
  label: { type: String, required: true },
  result: { type: String, enum: ['pending','won','lost','void'], default: 'pending' },
  settledAt: { type: Date, default: null },
}, { timestamps: true });
communityPickSchema.index({ userId: 1, fixtureId: 1, key: 1 }, { unique: true });
communityPickSchema.index({ fixtureId: 1, key: 1 });
module.exports = mongoose.model('CommunityPick', communityPickSchema);
