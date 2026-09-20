const mongoose = require('mongoose');
const predictionSchema = new mongoose.Schema({
  fixtureId: { type: String, required: true },
  modelVersion: { type: String, required: true },
  kickoff: { type: Date, required: true, index: true },
  league: { type: String, default: '' },
  homeTeam: { type: String, required: true },
  awayTeam: { type: String, required: true },
  capturedAt: { type: Date, default: Date.now },
  homeLambda: Number,
  awayLambda: Number,
  dataQualityScore: Number,
  probabilities: { type: mongoose.Schema.Types.Mixed, required: true },
  rawProbabilities: { type: mongoose.Schema.Types.Mixed, default: null },
  sportmonksEvidence: { type: mongoose.Schema.Types.Mixed, default: null },
  marketBoardSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
  status: { type: String, enum: ['pending','settled'], default: 'pending', index: true },
  actual: { type: mongoose.Schema.Types.Mixed, default: null },
  settledAt: Date,
}, { minimize: false });
predictionSchema.index({ fixtureId: 1, modelVersion: 1 }, { unique: true });
module.exports = mongoose.model('PredictionSnapshot', predictionSchema);
