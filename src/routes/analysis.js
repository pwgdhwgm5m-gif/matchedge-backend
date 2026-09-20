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
router.get('/sportmonks/diagnostic/:fixtureId', async (req, res) => {
  try {
    const intel = await sportmonks.getFixtureIntelligence(req.params.fixtureId);
    if (!intel.ok) return res.status(intel.status || 502).json({ ok:false, status:intel.status || null, error:intel.error || 'unavailable' });
    const s=intel.rawStatistics || {};
    res.json({ ok:true, fixtureId:intel.fixtureId, lineup:{home:intel.homeStarters?.length||0,away:intel.awayStarters?.length||0}, redCards:{home:intel.homeRedCards||0,away:intel.awayRedCards||0}, availableStats:Object.entries(s).filter(([,v])=>v!=null).map(([k])=>k) });
  } catch(e) { res.status(500).json({ok:false,error:e.message}); }
});

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
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('analysis_timeout')), 22000));
    let result = await Promise.race([analysisPromise, timeoutPromise]);
    // Add verified Sportmonks fixture intelligence when we can map the match.
    const smLive = await Promise.race([
      cache.getOrFetch('sportmonks:livescores', 60, () => sportmonks.getLivescores()),
      new Promise(resolve => setTimeout(() => resolve({ok:false,error:'sportmonks_timeout'}), 3500))
    ]);
    const sm = smLive.ok ? sportmonks.findMatch(smLive.fixtures, homeTeamName, awayTeamName) : null;
    if (sm?.sportmonksId) {
      const intel = await Promise.race([
        cache.getOrFetch(`sportmonks:intel:${sm.sportmonksId}`, 300, () => sportmonks.getFixtureIntelligence(sm.sportmonksId)),
        new Promise(resolve => setTimeout(() => resolve({ok:false,error:'sportmonks_intel_timeout'}), 3500))
      ]);
      if (intel.ok) {
        const lineupComplete = (intel.homeStarters?.length || 0) >= 11 && (intel.awayStarters?.length || 0) >= 11;
        const verifiedStats = Object.values(intel.rawStatistics || {}).filter(v => v != null).length;
        const smQualityBonus = Math.min(13, (verifiedStats >= 2 ? 3 : 0) + (verifiedStats >= 6 ? 3 : 0) + (verifiedStats >= 10 ? 2 : 0) + (lineupComplete ? 5 : 0));
        result = { ...result,
          dataQualityScore: Math.min(100, Number(result.dataQualityScore || 0) + smQualityBonus),
          sportmonks: { fixtureId: sm.sportmonksId, verified: verifiedStats > 0 || lineupComplete, verifiedStats, lineupComplete, homeStarters: intel.homeStarters, awayStarters: intel.awayStarters, homeRedCards: intel.homeRedCards, awayRedCards: intel.awayRedCards, statistics: intel.rawStatistics },
          enhancedDataSource: 'sportmonks'
        };
        if (result.marketBoard) {
          const health = Math.min(100, Number(result.premium?.dataHealth?.score || 0) + smQualityBonus);
          if (result.premium?.dataHealth) result.premium.dataHealth.score = health;
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
