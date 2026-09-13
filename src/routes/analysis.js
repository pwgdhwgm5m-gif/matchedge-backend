const express = require('express');
const router = express.Router();
const cache = require('../utils/cache');
const { computeFullAnalysis } = require('../services/analysisEngine');

/**
 * GET /api/analysis/:fixtureId
 * Query parametreleri: home, away (zorunlu, takim ID), league, season
 * (motivasyon icin), homeTeamName, awayTeamName (piyasa harmani icin), sportKey
 *
 * Once onceden hesaplanmis (precomputed) veriyi kontrol eder - bu da
 * ayni computeFullAnalysis motorunu kullanarak uretilmis oldugu icin
 * iki yol arasinda fark yoktur, sadece hiz farki vardir.
 */
router.get('/:fixtureId', async (req, res) => {
  const { fixtureId } = req.params;
  const { home, away, league, season, homeTeamName, awayTeamName, sportKey } = req.query;

  const precomputed = cache.get(`precomputed:${fixtureId}`);
  if (precomputed) {
    return res.json({ ...precomputed, source: 'precomputed' });
  }

  try {
    const result = await computeFullAnalysis({
      fixtureId, home, away, homeTeamName, awayTeamName, league, season, sportKey,
    });
    res.json({ ...result, source: 'realtime' });
  } catch (err) {
    console.error('[analysis] Hata:', err.message);
    res.status(500).json({ error: 'Analiz olusturulamadi', detail: err.message });
  }
});

module.exports = router;
