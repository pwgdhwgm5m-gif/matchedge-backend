const mongoose = require('mongoose');

const noteSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  match: { type: String, required: true },
  selection: { type: String, required: true },
  comment: { type: String, default: '' },
  fixtureId: { type: String, default: null },
  matchDate: { type: String, default: null },
  result: { type: String, enum: ['win', 'loss', null], default: null },
  autoChecked: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Note', noteSchema);
