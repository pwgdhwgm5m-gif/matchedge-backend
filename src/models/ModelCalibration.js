const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  key: { type: String, unique: true, required: true },
  league: { type: String, required: true },
  market: { type: String, required: true },
  logitOffset: { type: Number, default: 0 },
  calibrationVersion: { type: String, default: 'cal-v1' },
  modelVersion: { type: String, default: 'legacy' },
  active: { type: Boolean, default: false },
  trainCount: Number,
  validationCount: Number,
  baselineBrier: Number,
  adjustedBrier: Number,
  baselineLogLoss: Number,
  adjustedLogLoss: Number,
  trainedAt: Date,
}, { timestamps: true });
module.exports = mongoose.model('ModelCalibration', schema);
