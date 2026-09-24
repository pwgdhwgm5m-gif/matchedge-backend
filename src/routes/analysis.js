const express = require('express');
const router = express.Router();
const cache = require('../utils/cache');
const { computeFullAnalysis } = require('../services/analysisEngine');
const sportsDb = require('../services/sportsDbService');
const ledger = require('../services/predictionLedgerService');
const sportmonks = require('../services/sportmonksService');
const sourcePolicy = require('../services/sourcePolicyService');
const premiumLab = require('../services/premiumLabService');
const { hasStrongEvidence } = require('../services/marketEvidenceService');
const { requireAuth } = require('../middleware/authMiddleware');

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
router.get('/sportmonks/predictions-access',async(req,res)=>{try{const r=await sportmonks.request('/predictions/probabilities',{per_page:1});res.status(r.ok?200:(r.status||502)).json({ok:r.ok,status:r.status||200,predictionsAccess:r.ok,count:r.ok?(r.data?.data?.length||0):0,error:r.ok?null:r.error})}catch(e){res.status(500).json({ok:false,predictionsAccess:false,error:e.message})}});
router.get('/sportmonks/match-diagnostic', async (req, res) => {
  try {
    const { homeTeamName, awayTeamName } = req.query;
    if (!homeTeamName || !awayTeamName) return res.status(400).json({ok:false,error:'team_names_required'});
    const live = await Promise.race([
      sportmonks.getLivescores(),
      new Promise(resolve => setTimeout(() => resolve({ok:false,error:'timeout'}), 4000))
    ]);
    if (!live.ok) return res.status(502).json({ok:false,error:live.error||'unavailable'});
    const m = sportmonks.findMatch(live.fixtures, homeTeamName, awayTeamName);
    if (!m) return res.json({ok:true,matched:false});
    const [hh,ah] = await Promise.all([
      m.homeTeamId ? sportmonks.getTeamFixtureHistory(m.homeTeamId) : Promise.resolve({ok:false}),
      m.awayTeamId ? sportmonks.getTeamFixtureHistory(m.awayTeamId) : Promise.resolve({ok:false})
    ]);
    const home = hh.ok ? sportmonks.aggregateTeamHistory(hh.fixtures,m.homeTeamId) : null;
    const away = ah.ok ? sportmonks.aggregateTeamHistory(ah.fixtures,m.awayTeamId) : null;
    res.json({ok:true,matched:true,fixtureId:m.sportmonksId,history:{home,away}});
  } catch(e) { res.status(500).json({ok:false,error:e.message}); }
});

router.get('/sportmonks/diagnostic/:fixtureId', async (req, res) => {
  try {
    const intel = await sportmonks.getFixtureIntelligence(req.params.fixtureId);
    if (!intel.ok) return res.status(intel.status || 502).json({ ok:false, status:intel.status || null, error:intel.error || 'unavailable' });
    const s=intel.rawStatistics || {};
    res.json({ ok:true, fixtureId:intel.fixtureId, lineup:{home:intel.homeStarters?.length||0,away:intel.awayStarters?.length||0}, redCards:{home:intel.homeRedCards||0,away:intel.awayRedCards||0}, availableStats:Object.entries(s).filter(([,v])=>v!=null).map(([k])=>k) });
  } catch(e) { res.status(500).json({ok:false,error:e.message}); }
});

router.get('/:fixtureId/v4-intelligence',requireAuth,async(req,res)=>{
  try{
    const fixtureId=String(req.params.fixtureId);
    const [sim,similar,patterns]=await Promise.all([
      premiumLab.simulateFixture(fixtureId).catch(e=>({unavailable:true,error:e.message})),
      premiumLab.similarMatches(fixtureId,{limit:20}).catch(e=>({unavailable:true,error:e.message})),
      premiumLab.patternFinder({}).catch(e=>({unavailable:true,error:e.message}))
    ]);
    let value={unavailable:true};
    try{
      const vf=await premiumLab.valueFinder({limit:80});
      const match=(vf.matches||[]).find(x=>String(x.fixtureId)===fixtureId);
      value=match||{unavailable:true,providerAvailable:vf.providerAvailable,note:vf.note};
    }catch(e){value={unavailable:true,error:e.message}}
    const row=await ledger.reportCard(fixtureId);
    const lockedV4=await premiumLab.fixtureValidation(fixtureId);
    const pick=row.strongestPick||null;
    const mc=sim.simulation&&pick
      ? premiumLab.monteCarlo50k({fixtureId,homeLambda:sim.simulation.expectedGoals?.home,awayLambda:sim.simulation.expectedGoals?.away})
      : null;
    let simProb=null;
    if(mc&&pick){
      const k=pick.key;
      simProb=k==='home'?mc.home:k==='draw'?mc.draw:k==='away'?mc.away:k==='over25'?mc.over25:k==='under25'?mc.under25:k==='bttsYes'?mc.bttsYes:k==='bttsNo'?mc.bttsNo:null;
    }
    const modelProb=Number(pick?.probability);
    const gap=Number.isFinite(modelProb)&&simProb!=null?+Math.abs(modelProb-simProb).toFixed(1):null;
    const agreement=lockedV4?.agreement||(gap==null?'unavailable':gap<=4?'strong':gap<=8?'aligned':gap<=15?'mixed':'conflict');
    const health=Number((await require('../models/PredictionSnapshot').findOne({fixtureId}).select('dataQualityScore').lean())?.dataQualityScore||0);
    const activation=await ledger.v4ActivationStatus();
    const evidenceReady=hasStrongEvidence(pick);
    const baseStrong=!!pick&&evidenceReady&&modelProb>=60&&health>=55;
    const strongEdge=baseStrong&&(!activation.validated||(agreement==='strong'||agreement==='aligned'));
    const edgeClass=!pick?'NO_EDGE':!evidenceReady?'WATCH':strongEdge?'STRONG_EDGE':health<45?'RISKY':'WATCH';
    res.json({
      engine:'premium-v4-intelligence',fixtureId,edgeId:row.edgeId,strongestPick:pick,
      edgeDecision:{
        classification:edgeClass,strongEdge,modelProbability:modelProb,dataQualityScore:health,
        evidenceLevel:pick?.evidenceLevel||'INSUFFICIENT',effectiveSample:pick?.effectiveSample||0,
        v4Agreement:agreement,v4Mode:activation.mode,v4Validated:activation.validated,
        rule:activation.validated
          ? 'AI >=60 + data health >=55 + sufficient market evidence (effective sample >=8) + validated V4 strong/aligned'
          : 'AI >=60 + data health >=55 + sufficient market evidence (effective sample >=8); V4 shadow only'
      },
      v4Activation:activation,lockedValidation:lockedV4,
      simulation:mc?{runs:mc.runs,probability:simProb,gap,agreement:gap==null?'unavailable':gap<=4?'strong':gap<=8?'aligned':gap<=15?'mixed':'conflict',expectedGoals:sim.simulation.expectedGoals,mostLikelyScores:sim.simulation.mostLikelyScores}:sim,
      similarMatches:similar,patterns,value,
      policy:{primaryModel:'socceredge-ai',v4Role:'cross-check-and-evidence',weakFillerAllowed:false,noValueClaimWithoutVerifiedOdds:true}
    });
  }catch(e){res.status(e.status||500).json({error:'v4_intelligence_unavailable',detail:e.message})}
});
router.post('/v4-decisions',requireAuth,async(req,res)=>{
  try{
    const activation=await ledger.v4ActivationStatus();
    const ids=[...new Set((req.body?.fixtureIds||[]).map(String))].slice(0,60);
    const Prediction=require('../models/PredictionSnapshot');
    const rows=await Prediction.find({fixtureId:{$in:ids},status:'pending'}).select('fixtureId strongestPick dataQualityScore v4Validation').lean();
    res.json({
      v4Activation:activation,
      items:rows.map(x=>{
        const v=(x.v4Validation||[]).find(z=>z?.kind==='fixture-cross-check');
        const p=Number(x.strongestPick?.probability),health=Number(x.dataQualityScore||0);
        const agreement=v?.agreement||'unavailable',evidenceReady=hasStrongEvidence(x.strongestPick);
        const baseStrong=!!x.strongestPick&&evidenceReady&&p>=60&&health>=55;
        const strongEdge=baseStrong&&(!activation.validated||(agreement==='strong'||agreement==='aligned'));
        return{
          fixtureId:x.fixtureId,strongestPick:x.strongestPick,
          classification:!x.strongestPick?'NO_EDGE':!evidenceReady?'WATCH':strongEdge?'STRONG_EDGE':health<45?'RISKY':'WATCH',
          strongEdge,dataQualityScore:health,evidenceLevel:x.strongestPick?.evidenceLevel||'INSUFFICIENT',
          effectiveSample:x.strongestPick?.effectiveSample||0,v4Agreement:agreement,
          v4Mode:activation.mode,v4Validated:activation.validated
        };
      })
    });
  }catch(e){res.status(500).json({error:'v4_decisions_unavailable'})}
});
router.get('/model/v4-performance',async(req,res)=>{try{res.json({activation:await ledger.v4ActivationStatus(),rows:await ledger.v4CrossCheckPerformance()})}catch(e){res.status(500).json({error:'v4_performance_unavailable'})}});
router.get('/:fixtureId/report-card',async(req,res)=>{try{res.json(await ledger.reportCard(req.params.fixtureId))}catch(e){res.status(500).json({error:'report_card_unavailable'})}});
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
    if (kickoff && homeTeamName && awayTeamName) {
      try {
        const precomputedPolicy=sourcePolicy.policy({leagueName,sportKey});
        const canonicalProvider=precomputedPolicy.primary==='sportmonks'?'sportmonks':precomputedPolicy.primary==='bsd'?'bsd':'sportsdb';
        await ledger.capture(precomputed,{fixtureId,kickoff,league:leagueName,homeTeam:homeTeamName,awayTeam:awayTeamName,
          canonicalProvider,providerIds:{[canonicalProvider]:String(fixtureId)}});
        await premiumLab.lockFixtureValidation(fixtureId);
      } catch(e) { console.warn('[prediction-capture/precomputed]',e.message); }
    }
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
      fixtureId, home, away, homeTeamName, awayTeamName, league, tsdbLeagueId, leagueName, season, sportKey, kickoff,
    });
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('analysis_timeout')), 22000));
    let result = await Promise.race([analysisPromise, timeoutPromise]);
    // SportMonks is queried only for the six subscribed core leagues.
    const providerPolicy = sourcePolicy.policy({leagueName, sportKey});
    // Add verified Sportmonks fixture intelligence when we can map the match.
    const smLookup = providerPolicy.sportmonks ? await Promise.race([
      cache.getOrFetch(`sportmonks:fixture-match:${providerPolicy.sportmonksLeagueId||'all'}:${String(kickoff||'no-date').slice(0,10)}:${homeTeamName}:${awayTeamName}`, 300,
        () => sportmonks.getFixtureForMatch(homeTeamName, awayTeamName, kickoff, providerPolicy.sportmonksLeagueId)),
      new Promise(resolve => setTimeout(() => resolve({ok:false,error:'sportmonks_timeout'}), 3500))
    ]) : {ok:false,error:'sportmonks_not_subscribed_for_league'};
    const sm = smLookup.ok ? smLookup.fixture : null;
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
        const homeStarterCount = intel.homeStarters?.length || 0;
        const awayStarterCount = intel.awayStarters?.length || 0;
        const lineupComplete = homeStarterCount >= 11 && awayStarterCount >= 11;
        // Confirmed lineups are evidence, not an arbitrary performance multiplier.
        // Only a complete XI for both teams is allowed to improve confidence.
        const lineupStatus = lineupComplete ? 'CONFIRMED' : (homeStarterCount || awayStarterCount ? 'PARTIAL' : 'UNAVAILABLE');
        const lineupEvidence = { confirmed: lineupComplete, status: lineupStatus, homeCount: homeStarterCount, awayCount: awayStarterCount, affectsProbabilities: false, policy: lineupComplete ? 'confirmed-xi-confidence-only' : 'no-lineup-effect' };
        const availableFixtureStats = Object.entries(intel.rawStatistics || {}).filter(([,value]) => value != null).map(([key]) => key);
        const verifiedStats = availableFixtureStats.length;
        const qualityDimensions = result.qualityDimensions ? {
          ...result.qualityDimensions,
          sourceHealth: {
            ...(result.qualityDimensions.sourceHealth || {}),
            providers: {
              ...(result.qualityDimensions.sourceHealth?.providers || {}),
              sportmonks: {
                ...(result.qualityDimensions.sourceHealth?.providers?.sportmonks || {}),
                currentFixtureStatsAvailable: verifiedStats > 0,
                currentFixtureStatsCount: verifiedStats,
              },
            },
          },
          metricCoverage: {
            ...(result.qualityDimensions.metricCoverage || {}),
            sportmonksCurrentFixture: {
              availableFields: verifiedStats,
              fields: availableFixtureStats,
              consumedByPreMatchModel: false,
              note: 'Current-fixture statistics and lineups are diagnostics, not pre-match historical evidence.',
            },
          },
        } : result.qualityDimensions;
        result = { ...result,
          qualityDimensions,
          sportmonks: { fixtureId: sm.sportmonksId, verified: verifiedStats > 0 || lineupComplete || !!smHistory, verifiedStats, lineupComplete, lineupStatus, lineupEvidence, lineupCounts:{home:homeStarterCount,away:awayStarterCount}, homeStarters: lineupComplete ? intel.homeStarters : [], awayStarters: lineupComplete ? intel.awayStarters : [], homeRedCards: intel.homeRedCards, awayRedCards: intel.awayRedCards, statistics: intel.rawStatistics, historical: smHistory },
          enhancedDataSource: 'sportmonks'
        };
        if (result.marketBoard) {
          // Current-fixture stats and lineups are visible diagnostics only. They
          // must not raise historical evidence health or Strong Pick eligibility.
          const health = Number(result.premium?.dataHealth?.score || 0);
          if (result.premium?.dataHealth) {
            result.premium.dataHealth.checks = { ...(result.premium.dataHealth.checks || {}), confirmedLineups: lineupComplete };
            if (lineupStatus === 'PARTIAL' && !result.premium.blockers?.includes('LINEUPS_PARTIAL')) result.premium.blockers = [...(result.premium.blockers || []), 'LINEUPS_PARTIAL'];
            if (lineupStatus === 'UNAVAILABLE' && !result.premium.blockers?.includes('LINEUPS_UNAVAILABLE')) result.premium.blockers = [...(result.premium.blockers || []), 'LINEUPS_UNAVAILABLE'];
            result.premium.lineupEvidence = lineupEvidence;
            // Missing/partial lineups remain visible as warnings only.
            // They never suppress the model selection; the user makes the final decision.
            if (!lineupComplete) {
              result.premium.blockers = [...new Set([...(result.premium.blockers || []), lineupStatus === 'PARTIAL' ? 'LINEUPS_PARTIAL' : 'LINEUPS_UNAVAILABLE'])];
            }
          }
          result.marketBoard.allMarkets = (result.marketBoard.allMarkets || []).map(x => ({...x, dataHealth: health}));
          result.marketBoard.topPredictions = (result.marketBoard.topPredictions || [])
            .filter(x => x.isBettingValue === true && x.strongPickEligible === true)
            .slice(0,3);
          result.marketBoard.best = result.marketBoard.topPredictions[0] || null;
        }
      }
    }
    if (result?.modelDiagnostics) {
      const p=result.modelDiagnostics.probabilities?.marketBlended||result.modelDiagnostics.probabilities?.confidenceAdjusted||{};
      const extreme=Math.max(Number(p.homeWinProbability||0),Number(p.awayWinProbability||0))>=75;
      const weakAgreement=Number(result.modelDiagnostics.modelAgreement?.score||100)<70;
      if(extreme||weakAgreement) console.log('[model-diagnostic]', JSON.stringify({
        fixtureId:String(fixtureId), homeTeam:homeTeamName, awayTeam:awayTeamName,
        reason:extreme?'extreme-final-probability':'model-disagreement',
        diagnostics:result.modelDiagnostics
      }));
    }
    if (kickoff && homeTeamName && awayTeamName) {
      try {
        const canonicalProvider=sm?.sportmonksId?'sportmonks':providerPolicy.primary==='bsd'?'bsd':'sportsdb';
        const canonicalId=sm?.sportmonksId||fixtureId;
        await ledger.capture(result, { fixtureId, kickoff, league: leagueName, homeTeam: homeTeamName, awayTeam: awayTeamName,
          canonicalProvider,providerIds:{[canonicalProvider]:String(canonicalId)} });
        await premiumLab.lockFixtureValidation(fixtureId);
      } catch(err) { console.error('[prediction-capture]', err); }
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
