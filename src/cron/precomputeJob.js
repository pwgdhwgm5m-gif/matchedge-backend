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

const PRECOMPUTE_TSDB_LEAGUES = {
  '4339': '71',   // Türkiye Süper Lig (TFF scraper)
  '4328': '47',   // Premier League
  '4335': '87',   // La Liga
  '4332': '55',   // Serie A
  '4331': '54',   // Bundesliga
  '4334': '53',   // Ligue 1
  '4337': '57',   // Eredivisie
  '4336': '135',  // Yunanistan Super League
  '4358': '59',   // Norvec Eliteserien
  '4347': '67',   // Isvec Allsvenskan
  '4422': '196',  // Polonya Ekstraklasa
  '4355': '63',   // Rusya Premier Lig
  '4344': '61',   // Portekiz Liga Portugal
  '4636': '51',   // Finlandiya Veikkausliiga
  '4338': '40',   // Belcika First Division A
  '4340': '46',   // Danimarka Superligaen
  '4330': '64',   // Iskocya Premiership
  '4629': '252',  // Hirvatistan HNL
  '4691': '189',  // Romanya Liga I
  '4510': '4510', // Portekiz Kupasi
  '4641': '4641', // Netherlands Eerste Divisie
  '4490': '4490', // UEFA Nations League
  '4480': '4480', // UEFA Champions League
  '4481': '4481', // UEFA Europa League
  '5071': '5071', // UEFA Conference League
};

const TSDB_SPORT_KEYS = {
  '4339':'soccer_turkey_super_league','4328':'soccer_epl','4335':'soccer_spain_la_liga',
  '4332':'soccer_italy_serie_a','4331':'soccer_germany_bundesliga','4334':'soccer_france_ligue_one',
  '4337':'soccer_netherlands_eredivisie','4336':'soccer_greece_super_league','4358':'soccer_norway_eliteserien',
  '4347':'soccer_sweden_allsvenskan','4422':'soccer_poland_ekstraklasa','4355':'soccer_russia_premier_league',
  '4344':'soccer_portugal_primeira_liga','4636':'soccer_finland_veikkausliiga','4338':'soccer_belgium_first_div',
  '4340':'soccer_denmark_superliga','4330':'soccer_spl'
};

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
    const result=await bsd.fetchBsdAll('/events/?date_from='+day+'&date_to='+day,5*60,8000);
    if(!result.ok)continue;
    for(const raw of bsd.extractList(result.data)){
      const m=bsd.eventToResultMatch(raw);
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
      const fotmobLeague=PRECOMPUTE_TSDB_LEAGUES[String(e.idLeague)];
      if(!fotmobLeague)continue;
      const kickoff=sportsDb.toUtcIso(e.strTimestamp||(e.dateEvent+'T'+(e.strTime||'00:00:00')));
      if(!kickoff||new Date(kickoff)<=new Date())continue;
      upcomingFixtures.push({canonicalProvider:'sportsdb',fixtureId:e.idEvent,
        home:e.idHomeTeam,away:e.idAwayTeam,homeTeamName:e.strHomeTeam,awayTeamName:e.strAwayTeam,
        league:fotmobLeague,tsdbLeagueId:String(e.idLeague),leagueName:e.strLeague,
        season:new Date().getFullYear(),sportKey:TSDB_SPORT_KEYS[String(e.idLeague)]||null,kickoff});
    }
  }

  console.log(`[precompute] ${upcomingFixtures.length} uygun mac bulundu (${Object.keys(PRECOMPUTE_TSDB_LEAGUES).length} lig).`);

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
