const mongoose = require('mongoose');

const selectionSchema = new mongoose.Schema({
  key: { type: String, required: true },
  market: { type: String, required: true },
  label: { type: String, required: true },
  probability: { type: Number, default: null },
  result: { type: String, enum: ['pending', 'won', 'lost', 'void'], default: 'pending' },
}, { _id: false });

const couponSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  fixtureId: { type: String, required: true, index: true },
  homeTeam: { type: String, required: true },
  awayTeam: { type: String, required: true },
  league: { type: String, default: '' },
  kickoff: { type: Date, default: null },
  matchDate: { type: String, default: null },
  selections: { type: [selectionSchema], validate: value => value.length > 0 && value.length <= 9 },
  status: { type: String, enum: ['pending', 'won', 'lost', 'void'], default: 'pending' },
  finalScore: { home: Number, away: Number },
  settledAt: { type: Date, default: null },
  stakeCoins: { type: Number, default: 0, min: 0 },
  payoutMultiplier: { type: Number, default: 1, min: 1 },
  potentialPayout: { type: Number, default: 0, min: 0 },
  netCoinResult: { type: Number, default: 0 },
  rewardsProcessed: { type: Boolean, default: false, index: true },
  xpAwarded: { type: Number, default: 0, min: 0 },
  coinsAwarded: { type: Number, default: 0, min: 0 },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Coupon', couponSchema);
