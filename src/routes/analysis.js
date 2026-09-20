const express = require('express');
const router = express.Router();
const cache = require('../utils/cache');
const { computeFullAnalysis } = require('../services/analysisEngine');
const sportsDb = require('../services/sportsDbService');
const ledger = require('../services/predictionLedgerService');
const sportmonks = require('../services/sportmonksService');

/**
 * GET /api/analysis/:fixtureId
 * Query parametreleri:
 *   - home, away: takim ID (opsiyonel)
 *   - league: FotMob leagueId (dogrudan biliniyorsa)
 *   - tsdbLeagueId: TheSportsDB idLeague - "league" verilmemisse bundan
 *     FotMob ID'sine cevrilir
 *   - season, sportKey: motivasyon/piyasa harmani icin
 *   - homeTeamName, awayTeamName, leagueName, kickoff: EKRANDA GOSTERMEK
 *     icin - hesaplamaya girmez, sadece yaniti tamamlar
 */
router.get('/:fixtureId', async (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.removeHeader('ETag');
  const { fixtureId } = req.params;
  const {
    home, away, season, sportKey,
    homeTeamName, awayTeamName, leagueName, kickoff, tsdbLeagueId,
  } = req.query;

  let { league } = req.query;
  if (!league && tsdbLeagueId) {
    league = sportsDb.getFotmobIdForTsdbLeague(tsdbLeagueId) || undefined;
  }

  const precomputed = cache.get(`precomputed:${fixtureId}`);
  if (precomputed) {
    return res.json({
      ...precomputed,
      homeTeam: precomputed.homeTeam || homeTeamName,
      awayTeam: precomputed.awayTeam || awayTeamName,
      league: precomputed.league || leagueName,
      kickoff: precomputed.kickoff || kickoff,
      source: 'precomputed',
    });
  }

  try {
    const analysisPromise = computeFullAnalysis({
      fixtureId, home, away, homeTeamName, awayTeamName, league, tsdbLeagueId, leagueName, season, sportKey,
    });
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('analysis_timeout')), 15000));
    let result = await Promise.race([analysisPromise, timeoutPromise]);
    // Add verified Sportmonks fixture intelligence when we can map the match.
    const smLive = await cache.getOrFetch('sportmonks:livescores', 60, () => sportmonks.getLivescores());
    const sm = smLive.ok ? sportmonks.findMatch(smLive.fixtures, homeTeamName, awayTeamName) : null;
    if (sm?.sportmonksId) {
      const intel = await cache.getOrFetch(`sportmonks:intel:${sm.sportmonksId}`, 300, () => sportmonks.getFixtureIntelligence(sm.sportmonksId));
      if (intel.ok) {
        const lineupComplete = (intel.homeStarters?.length || 0) >= 11 && (intel.awayStarters?.length || 0) >= 11;
        const smQualityBonus = 8 + (lineupComplete ? 5 : 0);
        result = { ...result,
          dataQualityScore: Math.min(100, Number(result.dataQualityScore || 0) + smQualityBonus),
          sportmonks: { fixtureId: sm.sportmonksId, verified: true, lineupComplete, homeStarters: intel.homeStarters, awayStarters: intel.awayStarters, homeRedCards: intel.homeRedCards, awayRedCards: intel.awayRedCards, statistics: intel.rawStatistics },
          enhancedDataSource: 'sportmonks'
        };
        if (result.marketBoard) {
          const health = Math.min(100, Number(result.premium?.dataHealth?.score || 0) + smQualityBonus);
          result.marketBoard.allMarkets = (result.marketBoard.allMarkets || []).map(x => ({...x, dataHealth: health}));
          result.marketBoard.topPredictions = result.marketBoard.allMarkets.slice(0,3);
          result.marketBoard.best = health >= 45 ? (result.marketBoard.allMarkets[0] || null) : null;
        }
      }
    }
    if (kickoff && homeTeamName && awayTeamName) {
      ledger.capture(result, { fixtureId, kickoff, league: leagueName, homeTeam: homeTeamName, awayTeam: awayTeamName })
        .catch(err => console.error('[prediction-capture]', err));
    }
    res.json({
      ...result,
      homeTeam: homeTeamName,
      awayTeam: awayTeamName,
      league: leagueName,
      kickoff,
      source: 'realtime',
    });
  } catch (err) {
    console.error('[analysis] Hata:', err.message);
    res.status(500).json({ error: 'Analiz olusturulamadi', detail: err.message });
  }
});

module.exports = router;
