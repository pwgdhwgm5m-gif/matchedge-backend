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
        // Historical Sportmonks layer: only completed fixtures, bounded so it can
        // never block the base model. These aggregates are evidence/context, not
        // arbitrary probability multipliers.
        let smHistory = null;
        if (sm.homeTeamId && sm.awayTeamId) {
          const [hh, ah] = await Promise.all([
            Promise.race([
              cache.getOrFetch(`sportmonks:history:${sm.homeTeamId}`, 1800, () => sportmonks.getTeamFixtureHistory(sm.homeTeamId)),
              new Promise(resolve => setTimeout(() => resolve({ok:false,error:'history_timeout'}), 3000))
            ]),
            Promise.race([
              cache.getOrFetch(`sportmonks:history:${sm.awayTeamId}`, 1800, () => sportmonks.getTeamFixtureHistory(sm.awayTeamId)),
              new Promise(resolve => setTimeout(() => resolve({ok:false,error:'history_timeout'}), 3000))
            ])
          ]);
          if (hh.ok || ah.ok) {
            smHistory = {
              home: hh.ok ? sportmonks.aggregateTeamHistory(hh.fixtures, sm.homeTeamId) : null,
              away: ah.ok ? sportmonks.aggregateTeamHistory(ah.fixtures, sm.awayTeamId) : null
            };
          }
        }
        const lineupComplete = (intel.homeStarters?.length || 0) >= 11 && (intel.awayStarters?.length || 0) >= 11;
        const verifiedStats = Object.values(intel.rawStatistics || {}).filter(v => v != null).length;
        const smQualityBonus = Math.min(13, (verifiedStats >= 2 ? 3 : 0) + (verifiedStats >= 6 ? 3 : 0) + (verifiedStats >= 10 ? 2 : 0) + (lineupComplete ? 5 : 0));
        result = { ...result,
          dataQualityScore: Math.min(100, Number(result.dataQualityScore || 0) + smQualityBonus),
          sportmonks: { fixtureId: sm.sportmonksId, verified: verifiedStats > 0 || lineupComplete || !!smHistory, verifiedStats, lineupComplete, homeStarters: intel.homeStarters, awayStarters: intel.awayStarters, homeRedCards: intel.homeRedCards, awayRedCards: intel.awayRedCards, statistics: intel.rawStatistics, historical: smHistory },
          enhancedDataSource: 'sportmonks'
        };
        if (result.marketBoard) {
          // Keep the strongest-selection pool focused on the four core betting markets.
          // Sportmonks fixture stats improve data quality here; they do not rewrite
          // pre-match probabilities with in-play/single-fixture numbers.
          const health = Math.min(100, Number(result.premium?.dataHealth?.score || 0) + smQualityBonus);
          if (result.premium?.dataHealth) result.premium.dataHealth.score = health;
          result.marketBoard.allMarkets = (result.marketBoard.allMarkets || []).map(x => ({...x, dataHealth: health}));
          const coreMarkets = (result.marketBoard.allMarkets || []).filter(x => ['1X2','GOL','KG','KORNER'].includes(x.market));
          result.marketBoard.topPredictions = coreMarkets.slice(0,3);
          result.marketBoard.best = health >= 55 && result.premium?.status !== 'NO_BET' ? (coreMarkets[0] || null) : null;
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
