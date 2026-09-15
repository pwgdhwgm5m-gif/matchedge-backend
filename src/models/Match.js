const mongoose = require('mongoose');

/**
 * Gunluk toplanan mac verilerini saklar. API-Football'in askida olmasi
 * nedeniyle, free-api-live-football-data kaynagindan cekilen maclar
 * burada birikiyor - boylece her analiz isteginde API'ye gitmek yerine
 * veritabanindan hizli sorgu yapilabiliyor.
 */
const matchSchema = new mongoose.Schema({
  fixtureId: { type: String, required: true, unique: true },
  leagueId: { type: Number, required: true, index: true },
  kickoff: { type: Date, required: true, index: true },
  homeTeamName: { type: String, required: true },
  awayTeamName: { type: String, required: true },
  homeTeamNameNormalized: { type: String, required: true, index: true },
  awayTeamNameNormalized: { type: String, required: true, index: true },
  homeScore: { type: Number, default: null },
  awayScore: { type: Number, default: null },
  finished: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Match', matchSchema);
