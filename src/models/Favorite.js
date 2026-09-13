const mongoose = require('mongoose');

const favoriteSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  fixtureId: { type: String, required: true },
  homeTeam: { type: String, default: '' },
  awayTeam: { type: String, default: '' },
  addedAt: { type: Date, default: Date.now },
});

// Ayni kullanici ayni maci iki kere favoriye ekleyemesin
favoriteSchema.index({ userId: 1, fixtureId: 1 }, { unique: true });

module.exports = mongoose.model('Favorite', favoriteSchema);
