const cron = require('node-cron');
const config = require('../config/config');
const cache = require('../utils/cache');
const footballApi = require('../services/footballApiService');
const oddsApi = require('../services/oddsApiService');
const sportsDb = require('../services/sportsDbService');
const bsd = require('../services/bsdService');
const sourcePolicy = require('../services/sourcePolicyService');
const competitionRegistry = require('../services/competitionRegistryService');
const Prediction = require('../models/PredictionSnapshot');
const { computeFullAnalysis } = require('../services/analysisEngine');
const ledger = require('../services/predictionLedgerService');
const modelCalibration = require('../services/modelCalibrationService');
const premiumLab = require('../services/premiumLabService');
const prematchArchive = require('../services/prematchArchiveService');

const DAYS_AHEAD = 7;
function selectPrecomputeFixtures(candidates,limit){
  const byTime=(a,b)=>new Date(a.kickoff)-new Date(b.kickoff);
  const group=f=>{const key=competitionRegistry.resolveCompetition({leagueName:f.leagueName})?.canonicalCompetitionKey||'';
    return key.startsWith('uefa-')||key==='netherlands-eerste-divisie'?'target':
      competitionRegistry.resolveCompetition({leagueName:f.leagueName})?.providerIds?.sportmonks?'core':'other';};
  const selected=[],seen=new Set();
  const take=(items,n)=>{for(const fixture of items.sort(byTime)){if(selected.length>=limit||n<=0)break;
    const key=`${fixture.canonicalProvider}:${fixture.fixtureId}`;if(seen.has(key))continue;
    seen.add(key);selected.push(fixture);n--;}};
  take(candidates.filter(f=>group(f)==='target'),Math.min(6,limit));
  take(candidates.filter(f=>group(f)==='core'),Math.min(6,Math.max(0,limit-selected.length)));
  take(candidates,limit-selected.length);
  return selected;
}
function dedupePrecomputeFixtures(fixtures){
  const selected=new Map();
  for(const fixture of fixtures){
    const competition=competitionRegistry.resolveCompetition({leagueName:fixture.leagueName});
    const key=[competition?.canonicalCompetitionKey||fixture.leagueName,
      competitionRegistry.normalizeTeamIdentity(fixture.homeTeamName),
      competitionRegistry.normalizeTeamIdentity(fixture.awayTeamName),String(fixture.kickoff).slice(0,10)].join(':');
    if(!selected.has(key)||(fixture.canonicalProvider==='bsd'&&!competition?.providerIds?.sportmonks))selected.set(key,fixture);
  }
  return [...selected.values()];
}

function formatDate(d) {
  return d.toISOString().split('T')[0];
}

async function precomputeTodaysMatches() {
  console.log(`[precompute] Onumuzdeki ${DAYS_AHEAD} gun taraniyor (BSD, sonra SportsDB)...`);

  const upcomingFixtures = [];

  // Discover BSD fixtures first. TheSportsDB fills only matches BSD omitted.
  for(let i=0;i<DAYS_AHEAD;i++){
    const date=new Date();date.setDate(date.getDate()+i);
    const day=formatDate(date);
    // This helper enriches BSD league IDs from its verified league registry.
    const result=await bsd.getResultMatchesForDate(day);
    if(!result.ok)continue;
    for(const m of result.matches||[]){
      const competition=competitionRegistry.resolveCompetition({leagueName:m.league,provider:'bsd',leagueId:m.leagueId});
      const kickoff=new Date(m.date||'');
      if(!competition?.visibleInCompetitionFilter||competition.providerIds?.sportmonks||
         !m.fixtureId||!m.homeTeam||!m.awayTeam||!Number.isFinite(kickoff.getTime())||kickoff<=new Date()||
         m.homeScore!=null||m.awayScore!=null)continue;
      upcomingFixtures.push({canonicalProvider:'bsd',fixtureId:m.fixtureId,
        homeTeamName:m.homeTeam,awayTeamName:m.awayTeam,leagueName:m.league,
        tsdbLeagueId:competition.providerIds.sportsdb||null,
        league:sportsDb.getFotmobIdForTsdbLeague(competition.providerIds.sportsdb)||null,
        season:new Date().getFullYear(),sportKey:sourcePolicy.oddsSportKeyForCompetition(competition.canonicalCompetitionKey)||null,
        kickoff:kickoff.toISOString()});
    }
  }

  for (let i = 0; i < DAYS_AHEAD; i++) {
    const date = new Date();
    date.setDate(date.getDate() + i);
    const dateStr = formatDate(date);
    const result = await sportsDb.getMatchesByDate(dateStr);
    if (!result.ok) continue;
    for(const e of (result.data?.events||[])){
      if(e.strStatus!=='NS')continue;
      const id=String(e.idLeague||'');
      const competition=competitionRegistry.resolveCompetition({provider:'sportsdb',leagueId:id});
      if(!sportsDb.isWhitelistedLeague(id)||!competition?.visibleInCompetitionFilter||
         !sportsDb.isLeagueIdentityConsistent(id,e.strLeague))continue;
      const kickoff=sportsDb.toUtcIso(e.strTimestamp||(e.dateEvent+'T'+(e.strTime||'00:00:00')));
      if(!kickoff||new Date(kickoff)<=new Date())continue;
      upcomingFixtures.push({canonicalProvider:'sportsdb',fixtureId:e.idEvent,
        home:e.idHomeTeam,away:e.idAwayTeam,homeTeamName:e.strHomeTeam,awayTeamName:e.strAwayTeam,
        league:sportsDb.getFotmobIdForTsdbLeague(id)||id,tsdbLeagueId:id,leagueName:e.strLeague,
        season:new Date().getFullYear(),sportKey:sourcePolicy.oddsSportKeyForCompetition(competition.canonicalCompetitionKey)||null,kickoff});
    }
  }

  console.log(`[precompute] ${upcomingFixtures.length} uygun mac bulundu (${sportsDb.WHITELISTED_LEAGUE_IDS.size} SportsDB whitelist ligi).`);

  const MAX_FIXTURES_PER_RUN = config.maxPrecomputeFixturesPerRun;
  const candidates=dedupePrecomputeFixtures(upcomingFixtures);
  const prioritized=selectPrecomputeFixtures(candidates,MAX_FIXTURES_PER_RUN);

  if (candidates.length > MAX_FIXTURES_PER_RUN) {
    console.log(`[precompute] Kota korumasi: ${candidates.length} mactan ${MAX_FIXTURES_PER_RUN} tanesi onden hesaplanacak.`);
  }

  for (const fixture of prioritized) {
    try {
      const canonicalFixtureKey=`${fixture.canonicalProvider}:${fixture.fixtureId}`;
      if(await Prediction.exists({canonicalFixtureKey,modelVersion:ledger.VERSION}))continue;
      const result = await computeFullAnalysis({
        fixtureId: fixture.fixtureId,
        home: fixture.home,
        away: fixture.away,
        homeTeamName: fixture.homeTeamName,
        awayTeamName: fixture.awayTeamName,
        league: fixture.league,
        tsdbLeagueId:fixture.tsdbLeagueId,
        leagueName: fixture.leagueName,
        season: fixture.season,
        sportKey: fixture.sportKey,
        kickoff:fixture.kickoff,
      });

      const precomputed = {
        ...result,
        homeTeam: fixture.homeTeamName,
        awayTeam: fixture.awayTeamName,
        league: fixture.leagueName,
        kickoff: fixture.kickoff,
        computedAt: new Date().toISOString(),
      };

      const cacheKey=prematchArchive.precomputedKey({fixtureId:fixture.fixtureId,
        homeTeam:fixture.homeTeamName,awayTeam:fixture.awayTeamName,kickoff:fixture.kickoff});
      if(cacheKey)cache.set(cacheKey, precomputed, config.cache.ttlPrecomputed);
      try {
        await prematchArchive.capture(precomputed,{fixtureId:fixture.fixtureId,kickoff:fixture.kickoff,
          league:fixture.leagueName,homeTeam:fixture.homeTeamName,awayTeam:fixture.awayTeamName,
          canonicalProvider:fixture.canonicalProvider});
      }catch(e){console.warn('[precompute/prematch-archive]',e.message)}
      await ledger.capture(precomputed, { fixtureId: fixture.fixtureId, kickoff: fixture.kickoff, league: fixture.leagueName,
        homeTeam: fixture.homeTeamName, awayTeam: fixture.awayTeamName, canonicalProvider:fixture.canonicalProvider,
        providerIds:{[fixture.canonicalProvider]:String(fixture.fixtureId)} });
      await premiumLab.lockFixtureValidation(fixture.fixtureId);
    } catch (err) {
      console.error(`[precompute] Mac ${fixture.fixtureId} icin hata:`, err.message);
    }
  }

  console.log('[precompute] Tur tamamlandi.');
}

function startKeepAlive() {
  console.warn(
    '[keep-alive] DEVRE DISI: Render, servisin kendi kendine surekli ping ' +
    'atmasini "anormal trafik" sayip hesabi askiya alma sebebi yapabiliyor. ' +
    'Bunun yerine README\'deki "Uyumayan Sunucu" bolumunde anlatilan ' +
    'HARICI bir uptime monitor (cron-job.org, UptimeRobot vb.) kullan - ' +
    'bu servis DISINDAN geldigi icin ayni risk soz konusu degil.'
  );
}

function startPrecomputeCron() {
  cron.schedule('0 6,13 * * *', precomputeTodaysMatches);
  console.log('[precompute] Cron zamanlandi: her gun 06:00 ve 13:00');

  // Startup'ta 50 agir analiz calistirma: kullanici isteklerine oncelik ver. Ilk tur 06:00/13:00 cronunda.
  cron.schedule('15 */3 * * *', () => ledger.settlePending().catch(err => console.error('[prediction-ledger]', err)));
  cron.schedule('*/15 * * * *', () => ledger.captureClosingLines().then(x=>{if(x.captured)console.log('[closing-line]',x)}).catch(err=>console.error('[closing-line]',err)));
  ledger.settlePending().then(() => modelCalibration.retrain()).catch(err => console.error('[prediction-ledger]', err));
  cron.schedule('45 3 * * *', () => modelCalibration.retrain().catch(err => console.error('[model-calibration]', err)));
  cron.schedule('0 4 * * *', () => require('../models/LoginEvent').deleteMany({loginAt:{$lt:new Date(Date.now()-90*86400000)}}).catch(err => console.error('[login-audit-retention]', err)));
}

function startOddsSnapshotCron() {
  if (!config.oddsSnapshotEnabled) { console.log('[odds-snapshot] DEVRE DISI: otomatik The Odds API harcamasi kapali.'); return; }
  if (!config.oddsApi.key) { console.log('[odds-snapshot] DEVRE DISI: ODDS_API_KEY yok.'); return; }
  cron.schedule(config.oddsSnapshotCron, async () => {
    for (const sportKey of config.trackedLeagues) {
      try {
        await oddsApi.recordOddsSnapshot(sportKey);
        console.log(`[odds-snapshot] ${sportKey} kaydedildi`);
      } catch (err) {
        console.error(`[odds-snapshot] ${sportKey} icin hata:`, err.message);
      }
    }
  });
  console.log(`[odds-snapshot] Cron zamanlandi: "${config.oddsSnapshotCron}" - ${config.trackedLeagues.length} lig takip ediliyor`);

  // Startup'ta 34 ligi ayni anda vurmak 429 firtinasi yaratiyordu. Ilk tarama cron saatinde yapilir.
}

module.exports = { startPrecomputeCron, startKeepAlive, startOddsSnapshotCron, precomputeTodaysMatches, selectPrecomputeFixtures, dedupePrecomputeFixtures };
