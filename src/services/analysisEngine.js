const cache = require('../utils/cache');
const config = require('../config/config');
const footballApi = require('./footballApiService');
const oddsApi = require('./oddsApiService');
const poisson = require('./poissonService');
const stats = require('./statsService');
const motivation = require('./motivationService');
const tffScraper = require('./tffScraper');
const sportsDb = require('./sportsDbService');
const premiumIntelligence = require('./premiumIntelligenceService');
const modelCalibration = require('./modelCalibrationService');
const accuracy = require('./accuracyEngineService');
const footballDataOdds = require('./footballDataUpcomingOddsService');
const sportmonks = require('./sportmonksService');
const powerRating = require('./powerRatingService');

const LEAGUE_AVG_HOME_GOALS = 1.45;
const LEAGUE_AVG_AWAY_GOALS = 1.15;
const LEAGUE_ADVANTAGE_RATIO = LEAGUE_AVG_HOME_GOALS / LEAGUE_AVG_AWAY_GOALS;

const SUPERLIG_LEAGUE_ID = '71';

async function computeFullAnalysis({ fixtureId, home, away, homeTeamName, awayTeamName, league, tsdbLeagueId, leagueName, season, sportKey }) {
  const isSuperLig = String(league) === SUPERLIG_LEAGUE_ID;
  const leagueIdNum = league ? parseInt(league, 10) : null;
  const mappedTsdbLeagueId = leagueIdNum ? sportsDb.LEAGUE_ID_MAP[String(leagueIdNum)] : null;
  const directTsdbLeagueId = tsdbLeagueId ? String(tsdbLeagueId) : null;
  const effectiveTsdbLeagueId = directTsdbLeagueId || (mappedTsdbLeagueId ? String(mappedTsdbLeagueId) : null);
  const isMappedLeague = Boolean(effectiveTsdbLeagueId && sportsDb.isWhitelistedLeague(effectiveTsdbLeagueId));
  const useOwnSource = isSuperLig || isMappedLeague;

  // API-Football (footballApiService) askida oldugu icin form verisi:
  // - Süper Lig -> TFF.org scraper
  // - Eslesmesi bilinen diger ligler -> TheSportsDB (Premium)
  // - Eslesmesi olmayan ligler -> eskisi gibi API-Football denenir (suspended
  //   oldugu icin muhtemelen bos doner, sistem yine de cokme, notr deger uretir)
  const homeFormFetcher = isSuperLig
    ? () => tffScraper.getTeamFixturesForAnalysis(homeTeamName, 15)
    : isMappedLeague
      ? () => sportsDb.getTeamFixturesForAnalysis(homeTeamName, leagueIdNum, 15, effectiveTsdbLeagueId)
      : () => Promise.resolve({ok:false,error:'legacy_api_disabled'});
  const awayFormFetcher = isSuperLig
    ? () => tffScraper.getTeamFixturesForAnalysis(awayTeamName, 15)
    : isMappedLeague
      ? () => sportsDb.getTeamFixturesForAnalysis(awayTeamName, leagueIdNum, 15, effectiveTsdbLeagueId)
      : () => Promise.resolve({ok:false,error:'legacy_api_disabled'});
  const homeFormCacheKey = isSuperLig
    ? `tff-form:${homeTeamName}`
    : isMappedLeague
      ? `tsdb-form:v2:${effectiveTsdbLeagueId}:${homeTeamName}`
      : `form:${home}`;
  const awayFormCacheKey = isSuperLig
    ? `tff-form:${awayTeamName}`
    : isMappedLeague
      ? `tsdb-form:v2:${effectiveTsdbLeagueId}:${awayTeamName}`
      : `form:${away}`;

  // H2H artik ayri bir API cagrisi degil - Süper Lig/eslesen liglerde zaten
  // cekilen "son N mac" form verisinden turetiliyor (asagida, fixture'lar
  // cozuldukten sonra). API-Football'un h2h endpoint'i askida/kota dolu
  // oldugu icin sadece eslesmeyen ligler icin fallback olarak kaliyor.
  const useDerivedH2H = isSuperLig || isMappedLeague;

  // Puan durumu (motivasyon icin): Süper Lig -> TFF scraper, eslesen
  // ligler -> TheSportsDB lookuptable.php, digerleri -> eski API-Football
  // yolu (kota dolu oldugu icin muhtemelen bos doner, notr deger uretir).
  const currentSeason = sportsDb.getCurrentSeasonString();
  const standingsFetcher = isSuperLig
    ? () => tffScraper.getStandings().then(table => ({
        ok: true,
        available: table.length > 0,
        table: table.map(r => ({ teamId: r.kulupID, teamName: r.name, rank: r.rank, points: r.points, description: null })),
      }))
    : isMappedLeague
      ? () => sportsDb.getLeagueStandingsFormatted(effectiveTsdbLeagueId, currentSeason)
      : () => Promise.resolve({ ok:false, error:'legacy_api_disabled' });
  const standingsCacheKey = isSuperLig
    ? 'tff-standings'
    : isMappedLeague
      ? `tsdb-standings:v2:${effectiveTsdbLeagueId}:${currentSeason}`
      : `standings:${league}:${season}`;

  const [h2hResult, oddsResult, injuriesResult, homeFixturesResult, awayFixturesResult, standingsResult] =
    await Promise.allSettled([
      useDerivedH2H
        ? Promise.resolve({ ok: true, skipped: true })
        : cache.getOrFetch(`h2h:${fixtureId}`, config.cache.ttlStatic, () =>
            footballApi.getH2H(home, away)
          ),
      config.oddsApi.key
        ? cache.getOrFetch(`odds:${sportKey || 'soccer_epl'}`, config.cache.ttlStatic, () => oddsApi.getOddsForLeague(sportKey || 'soccer_epl'))
        : Promise.resolve({ok:false,error:'odds_disabled'}),
      config.apiFootball.sources.length && !useOwnSource
        ? cache.getOrFetch(`injuries:${fixtureId}`, config.cache.ttlStatic, () => footballApi.getInjuries(fixtureId))
        : Promise.resolve({ok:false,error:'injuries_unavailable'}),
      cache.getOrFetch(homeFormCacheKey, config.cache.ttlStatic, homeFormFetcher),
      cache.getOrFetch(awayFormCacheKey, config.cache.ttlStatic, awayFormFetcher),
      cache.getOrFetch(standingsCacheKey, config.cache.ttlStatic, standingsFetcher),
    ]);

  const injuriesRaw = injuriesResult.status === 'fulfilled' && injuriesResult.value.ok
    ? injuriesResult.value.data?.response || []
    : [];
  const formatInjuries = (list) => list.map(item => ({
    player: item.player?.name,
    reason: item.player?.reason,
    teamId: item.team?.id,
  }));
  const allInjuries = formatInjuries(injuriesRaw);
  const injuries = {
    home: allInjuries.filter(p => String(p.teamId) === String(home)),
    away: allInjuries.filter(p => String(p.teamId) === String(away)),
  };

  const homeFixtures = homeFixturesResult.status === 'fulfilled' && homeFixturesResult.value.ok
    ? homeFixturesResult.value.data?.response || []
    : [];
  const awayFixtures = awayFixturesResult.status === 'fulfilled' && awayFixturesResult.value.ok
    ? awayFixturesResult.value.data?.response || []
    : [];

  const homeTeamIdForStats = useOwnSource && homeFixturesResult.status === 'fulfilled' && homeFixturesResult.value.teamId
    ? homeFixturesResult.value.teamId
    : home;
  const awayTeamIdForStats = useOwnSource && awayFixturesResult.status === 'fulfilled' && awayFixturesResult.value.teamId
    ? awayFixturesResult.value.teamId
    : away;

  // V2 Elo power rating: construct a chronological league/team evidence pool
  // from already-fetched completed fixtures. This is fail-open and bounded.
  const eloPool=[...homeFixtures,...awayFixtures].filter((f,i,a)=>a.findIndex(x=>String(x.fixture?.id)===String(f.fixture?.id))===i);
  const elo=powerRating.buildElo(eloPool);
  const [persistedHomePower,persistedAwayPower]=await Promise.all([
    powerRating.loadPersistentByIdentity(leagueName||league,homeTeamIdForStats,homeTeamName),
    powerRating.loadPersistentByIdentity(leagueName||league,awayTeamIdForStats,awayTeamName)
  ]);
  const homeElo=persistedHomePower?.elo||elo.rating(homeTeamIdForStats), awayElo=persistedAwayPower?.elo||elo.rating(awayTeamIdForStats);
  const homeEloGames=persistedHomePower?.games||elo.games(homeTeamIdForStats), awayEloGames=persistedAwayPower?.games||elo.games(awayTeamIdForStats);
  const eloAdjustment=powerRating.matchupMultiplier(homeElo,awayElo,homeEloGames,awayEloGames);

  const homeTeamFullSplit = stats.splitHomeAwayForm(homeFixtures, homeTeamIdForStats, 5);
  const awayTeamFullSplit = stats.splitHomeAwayForm(awayFixtures, awayTeamIdForStats, 5);
  const homeAwaySplit = {
    home: homeTeamFullSplit.home,
    away: awayTeamFullSplit.away,
  };

  let motivationHome = { label: 'Orta Sıra - Nötr', multiplier: 1.0 };
  let motivationAway = { label: 'Orta Sıra - Nötr', multiplier: 1.0 };
  // Ekranda gosterilecek ham puan durumu tablosu - sadece kendi kaynagimizdan
  // (TFF/TheSportsDB) gelen normallestirilmis tablo icin dolduruluyor; eski
  // API-Football yolu (askida) icin bos birakiliyor.
  let standingsTable = [];
  if (standingsResult.status === 'fulfilled' && standingsResult.value.ok) {
    const sv = standingsResult.value;
    if (isSuperLig || isMappedLeague) {
      const table = sv.table || [];
      standingsTable = table;
      const homeRow = motivation.findTeamStanding(table, homeTeamIdForStats);
      const awayRow = motivation.findTeamStanding(table, awayTeamIdForStats);
      if (homeRow) {
        motivationHome = homeRow.description
          ? motivation.calculateMotivationFromDescription(homeRow.description)
          : motivation.calculateMotivationFromRank(homeRow.rank, table.length);
      }
      if (awayRow) {
        motivationAway = awayRow.description
          ? motivation.calculateMotivationFromDescription(awayRow.description)
          : motivation.calculateMotivationFromRank(awayRow.rank, table.length);
      }
    } else if (sv.data) {
      const homeRow = motivation.findTeamStandingLegacy(sv.data, home);
      const awayRow = motivation.findTeamStandingLegacy(sv.data, away);
      motivationHome = motivation.calculateMotivationFromDescription(homeRow?.description);
      motivationAway = motivation.calculateMotivationFromDescription(awayRow?.description);
    }
  }

  const homeRestDays = isSuperLig ? null : stats.calculateRestDays(homeFixtures, homeTeamIdForStats);
  const awayRestDays = isSuperLig ? null : stats.calculateRestDays(awayFixtures, awayTeamIdForStats);
  const homeFatigue = stats.calculateFatigueMultiplier(homeRestDays);
  const awayFatigue = stats.calculateFatigueMultiplier(awayRestDays);

  const homeStreak = stats.calculateStreak(homeFixtures, homeTeamIdForStats);
  const awayStreak = stats.calculateStreak(awayFixtures, awayTeamIdForStats);
  const homeStreakMult = stats.streakMultiplier(homeStreak);
  const awayStreakMult = stats.streakMultiplier(awayStreak);

  const homeInjuryImpact = stats.calculateInjuryImpact(injuries.home.length);
  const awayInjuryImpact = stats.calculateInjuryImpact(injuries.away.length);

  const homeAdvantageMultiplier = stats.calculateTeamHomeAdvantageMultiplier(homeTeamFullSplit, LEAGUE_ADVANTAGE_RATIO);

  const homeForm = homeAwaySplit.home;
  const awayForm = homeAwaySplit.away;

  const homeAttackBase = homeForm.played > 0 ? homeForm.avgGoalsFor / LEAGUE_AVG_HOME_GOALS : 1.0;
  const homeDefenseWeakBase = homeForm.played > 0 ? homeForm.avgGoalsAgainst / LEAGUE_AVG_AWAY_GOALS : 1.0;
  const awayAttackBase = awayForm.played > 0 ? awayForm.avgGoalsFor / LEAGUE_AVG_AWAY_GOALS : 1.0;
  const awayDefenseWeakBase = awayForm.played > 0 ? awayForm.avgGoalsAgainst / LEAGUE_AVG_HOME_GOALS : 1.0;
  const powerComponents = {
    home: { attack:+((persistedHomePower?.attack||homeAttackBase)*.35+homeAttackBase*.65).toFixed(3), defense:+((persistedHomePower?.defense||(1/Math.max(.45,homeDefenseWeakBase)))*.35+(1/Math.max(.45,homeDefenseWeakBase))*.65).toFixed(3) },
    away: { attack:+((persistedAwayPower?.attack||awayAttackBase)*.35+awayAttackBase*.65).toFixed(3), defense:+((persistedAwayPower?.defense||(1/Math.max(.45,awayDefenseWeakBase)))*.35+(1/Math.max(.45,awayDefenseWeakBase))*.65).toFixed(3) }
  };

  const homeAttack = powerComponents.home.attack * homeInjuryImpact.attackMultiplier * homeFatigue * homeStreakMult * homeAdvantageMultiplier;
  const homeDefenseWeak = 1/Math.max(.45,powerComponents.home.defense) * homeInjuryImpact.defenseWeaknessMultiplier;
  const awayAttack = powerComponents.away.attack * awayInjuryImpact.attackMultiplier * awayFatigue * awayStreakMult;
  const awayDefenseWeak = 1/Math.max(.45,powerComponents.away.defense) * awayInjuryImpact.defenseWeaknessMultiplier;

  const analysisTsdbLeagueId = isSuperLig ? '4339' : (isMappedLeague ? effectiveTsdbLeagueId : null);
  const leagueBase = analysisTsdbLeagueId ? await accuracy.leagueBaselines(analysisTsdbLeagueId, currentSeason) : null;
  const leagueHomeGoals = leagueBase?.homeGoals || LEAGUE_AVG_HOME_GOALS;
  const leagueAwayGoals = leagueBase?.awayGoals || LEAGUE_AVG_AWAY_GOALS;

  const homeLambdaBase = poisson.calculateExpectedGoals(homeAttack, awayDefenseWeak, leagueHomeGoals, 1);
  const awayLambdaBase = poisson.calculateExpectedGoals(awayAttack, homeDefenseWeak, leagueAwayGoals, 1);
  let homeLambda = +(homeLambdaBase * motivationHome.multiplier).toFixed(2);
  let awayLambda = +(awayLambdaBase * motivationAway.multiplier).toFixed(2);

  // Opponent-strength prior + robust early-season control.
  const homeStanding = standingsTable.find(x=>String(x.teamId)===String(homeTeamIdForStats));
  const awayStanding = standingsTable.find(x=>String(x.teamId)===String(awayTeamIdForStats));
  const tableSize = standingsTable.length || 20;
  const rankStrength = row => row?.rank ? Math.max(-1,Math.min(1,(tableSize+1-2*Number(row.rank))/Math.max(1,tableSize-1))) : 0;
  const strengthGap=Math.max(-1,Math.min(1,rankStrength(homeStanding)-rankStrength(awayStanding)));
  homeLambda=+(homeLambda*Math.max(.92,Math.min(1.08,1+.08*strengthGap))).toFixed(2);
  awayLambda=+(awayLambda*Math.max(.92,Math.min(1.08,1-.08*strengthGap))).toFixed(2);
  homeLambda=+(homeLambda*eloAdjustment.home).toFixed(2);
  awayLambda=+(awayLambda*eloAdjustment.away).toFixed(2);
  const robustRate=(rate,sample,anchor)=>{
    if(!Number.isFinite(rate)||!sample) return anchor;
    const clipped=Math.max(anchor*.45,Math.min(anchor*2.1,rate));
    const w=Math.min(1,Number(sample)/8);
    return anchor*(1-w)+clipped*w;
  };
  if(homeForm?.played>0){const rr=robustRate(homeForm.avgGoalsFor,homeForm.played,leagueHomeGoals),raw=Math.max(.35,Number(homeForm.avgGoalsFor)||leagueHomeGoals);homeLambda=+(homeLambda*Math.max(.88,Math.min(1.12,rr/raw))).toFixed(2);}
  if(awayForm?.played>0){const rr=robustRate(awayForm.avgGoalsFor,awayForm.played,leagueAwayGoals),raw=Math.max(.35,Number(awayForm.avgGoalsFor)||leagueAwayGoals);awayLambda=+(awayLambda*Math.max(.88,Math.min(1.12,rr/raw))).toFixed(2);}

  // Premium TheSportsDB event stats: blend real historical xG into pre-match lambdas.
  // Falls back to the goal model whenever xG coverage/sample is insufficient.
  let advancedHomeFixtures = homeFixtures, advancedAwayFixtures = awayFixtures;
  let advancedHomeId = homeTeamIdForStats, advancedAwayId = awayTeamIdForStats;
  // Super Lig form is TFF-backed, whose event IDs are not TheSportsDB IDs.
  // Resolve a TSDB copy only for premium event-stat lookups so IDs can never cross sources.
  if (isSuperLig) {
    const [th, ta] = await Promise.all([
      sportsDb.getTeamFixturesForAnalysis(homeTeamName, 71, 10),
      sportsDb.getTeamFixturesForAnalysis(awayTeamName, 71, 10),
    ]);
    if (th?.ok) { advancedHomeFixtures = th.data?.response || []; advancedHomeId = th.teamId; }
    if (ta?.ok) { advancedAwayFixtures = ta.data?.response || []; advancedAwayId = ta.teamId; }
  }
  const [homeAdvanced, awayAdvanced] = await Promise.all([
    accuracy.teamAdvancedForm(advancedHomeFixtures, advancedHomeId, 8),
    accuracy.teamAdvancedForm(advancedAwayFixtures, advancedAwayId, 8),
  ]);
  homeLambda = accuracy.blendLambda(homeLambda, homeAdvanced, awayAdvanced, leagueHomeGoals);
  awayLambda = accuracy.blendLambda(awayLambda, awayAdvanced, homeAdvanced, leagueAwayGoals);

  // Sportmonks historical chance-quality layer. Only completed-match aggregates
  // with a useful sample are allowed to nudge expected goals; bounds prevent
  // sparse/noisy provider data from dominating the established model.
  let sportmonksHistorical = null;
  try {
    const liveIndex = await Promise.race([
      cache.getOrFetch('sportmonks:livescores', 60, () => sportmonks.getLivescores()),
      new Promise(resolve => setTimeout(() => resolve({ok:false}), 2500))
    ]);
    const smMatch = liveIndex.ok ? sportmonks.findMatch(liveIndex.fixtures, homeTeamName, awayTeamName) : null;
    if (smMatch?.homeTeamId && smMatch?.awayTeamId) {
      const [hh, ah] = await Promise.all([
        Promise.race([cache.getOrFetch(`sportmonks:history:${smMatch.homeTeamId}`,1800,()=>sportmonks.getTeamFixtureHistory(smMatch.homeTeamId)),new Promise(r=>setTimeout(()=>r({ok:false}),2500))]),
        Promise.race([cache.getOrFetch(`sportmonks:history:${smMatch.awayTeamId}`,1800,()=>sportmonks.getTeamFixtureHistory(smMatch.awayTeamId)),new Promise(r=>setTimeout(()=>r({ok:false}),2500))])
      ]);
      const sh = hh.ok ? sportmonks.aggregateTeamHistory(hh.fixtures, smMatch.homeTeamId) : null;
      const sa = ah.ok ? sportmonks.aggregateTeamHistory(ah.fixtures, smMatch.awayTeamId) : null;
      if ((sh?.sample || 0) >= 5 && (sa?.sample || 0) >= 5) {
        // Venue-specific history is materially more predictive for this fixture.
        // Require >=3 same-venue matches; otherwise blend the small venue sample
        // into the recency-weighted overall sample rather than overfitting it.
        const venueBlend = (overall, venue) => {
          if (!venue?.sample) return overall;
          if (venue.sample >= 3) return venue;
          const oa=overall?.averages||{}, va=venue?.averages||{}, averages={};
          for (const key of new Set([...Object.keys(oa),...Object.keys(va)])) {
            const o=oa[key], v=va[key];
            averages[key]=Number.isFinite(v)&&Number.isFinite(o) ? +(v*.35+o*.65).toFixed(2) : (Number.isFinite(v)?v:o);
          }
          return { sample:overall.sample, venueSample:venue.sample, averages, blended:true };
        };
        const shModel=venueBlend(sh,sh.home);
        const saModel=venueBlend(sa,sa.away);
        sportmonksHistorical = { home:shModel, away:saModel, rawHome:sh, rawAway:sa, venueSplit:true };
        const chance = (a, against=false) => {
          const v=a?.averages||{}, suffix=against?'Against':'';
          const r=(key,base)=>Number.isFinite(v[key+suffix])?Math.max(.55,Math.min(1.55,v[key+suffix]/base)):null;
          const quality=[r('bigChances',2.2),r('shotsOnTarget',4.5)].filter(Number.isFinite);
          const volume=[r('shotsInsideBox',7),r('shots',13)].filter(Number.isFinite);
          const q=quality.length?quality.reduce((x,y)=>x+y,0)/quality.length:null;
          const vol=volume.length?volume.reduce((x,y)=>x+y,0)/volume.length:null;
          if(q==null) return vol; if(vol==null) return q;
          return .72*q+.28*vol;
        };
        const homeAttackQuality=chance(shModel), awayAttackQuality=chance(saModel);
        const awayConcessionQuality=chance(saModel,true), homeConcessionQuality=chance(shModel,true);
        const blendQuality = (attack, opponentConcession) => {
          if (attack == null) return opponentConcession;
          if (opponentConcession == null) return attack;
          return attack * .65 + opponentConcession * .35;
        };
        const hc=blendQuality(homeAttackQuality,awayConcessionQuality);
        const ac=blendQuality(awayAttackQuality,homeConcessionQuality);
        if (hc!=null) homeLambda=+(homeLambda*Math.max(.90,Math.min(1.10,0.8+0.2*hc))).toFixed(2);
        if (ac!=null) awayLambda=+(awayLambda*Math.max(.90,Math.min(1.10,0.8+0.2*ac))).toFixed(2);
      }
    }
  } catch (_) {}

  // Final lambda regularization.
  // The upstream layers (form, defence weakness, motivation, Elo, xG/chance quality)
  // are useful individually, but multiplying them can compound the same signal and
  // create implausible goal rates on sparse samples. Anchor the final rate to a
  // robust matchup prior built from the team's scoring rate and the opponent's
  // concession rate. This is shrinkage, not a hard-coded score prediction.
  const ensembleLambda = (structuralLambda, ownForm, oppForm, ownAdvanced, oppAdvanced, leagueGoalBase, strengthEdge=0) => {
    const ownSample=Number(ownForm?.played||0),oppSample=Number(oppForm?.played||0);
    if(!ownSample||!oppSample||!Number.isFinite(structuralLambda)) return structuralLambda;
    // Independent evidence families are averaged, never multiplied here.
    // Venue form is deliberately important early in the season because five/six
    // matches can represent nearly the whole current campaign.
    const ownRate=robustRate(Number(ownForm.avgGoalsFor),ownSample,leagueGoalBase);
    const oppConcede=robustRate(Number(oppForm.avgGoalsAgainst),oppSample,leagueGoalBase);
    const matchupModel=(ownRate+oppConcede)/2;
    const xgReady=Number(ownAdvanced?.xgSample||0)>=3&&Number(oppAdvanced?.xgSample||0)>=3&&
      Number.isFinite(ownAdvanced?.avgXgFor)&&Number.isFinite(oppAdvanced?.avgXgAgainst);
    const xgModel=xgReady?Math.max(.15,Math.min(4.8,(Number(ownAdvanced.avgXgFor)+Number(oppAdvanced.avgXgAgainst))/2)):null;
    const sample=Math.min(ownSample,oppSample),sampleStrength=Math.min(1,sample/8);
    const components=[
      {name:'venue-recent-form',value:matchupModel,weight:.45},
      {name:'structural-power-context',value:structuralLambda,weight:.35+.10*sampleStrength},
    ];
    if(xgModel!=null) components.push({name:'chance-quality-xg',value:xgModel,weight:.20+.10*Math.min(1,Math.min(ownAdvanced.xgSample,oppAdvanced.xgSample)/7)});
    const totalWeight=components.reduce((s,c)=>s+c.weight,0);
    let blended=components.reduce((s,c)=>s+c.value*c.weight,0)/totalWeight;
    // Genuine elite-v-weak mismatches keep a thicker scoring expectation instead
    // of being blindly pulled back to an average team. The adjustment is bounded
    // and additive so rank/Elo/form cannot compound exponentially.
    const mismatch=Math.max(0,Math.min(1,Number(strengthEdge)||0));
    if(mismatch>.55 && ownRate>leagueGoalBase*1.35 && oppConcede>leagueGoalBase*1.35) {
      blended += leagueGoalBase * .22 * ((mismatch-.55)/.45);
    }
    const prior=matchupModel,evidence=Math.min(1,sample/8);
    const lower=prior*(.72-.07*evidence), upper=prior*(1.48+.22*mismatch);
    return +Math.max(lower,Math.min(upper,blended)).toFixed(2);
  };
  homeLambda=ensembleLambda(homeLambda,homeForm,awayForm,homeAdvanced,awayAdvanced,leagueHomeGoals,Math.max(0,strengthGap));
  awayLambda=ensembleLambda(awayLambda,awayForm,homeForm,awayAdvanced,homeAdvanced,leagueAwayGoals,Math.max(0,-strengthGap));

  // League/time-aware Dixon-Coles layer. Recent completed matches carry more weight;
  // sparse samples stay close to conservative defaults.
  const leagueDc=poisson.estimateLeagueParameters(eloPool,{halfLifeDays:240});
  const dcReliability=Math.min(1,leagueDc.sample/40);
  const fittedRho=poisson.DEFAULT_RHO*(1-dcReliability)+leagueDc.rho*dcReliability;
  const dynamicHome=Math.pow(leagueDc.homeAdvantage/LEAGUE_ADVANTAGE_RATIO,Math.min(.35,dcReliability*.35));
  homeLambda=+(homeLambda*Math.max(.94,Math.min(1.06,dynamicHome))).toFixed(2);
  const rawMatchProbabilities = poisson.calculateMatchProbabilities(homeLambda, awayLambda,10,fittedRho);
  const rawMarketProbabilities = poisson.calculateMarketProbabilities(homeLambda, awayLambda,10,fittedRho);
  const calibrated = await modelCalibration.apply({league: leagueName || String(league || ''), match: rawMatchProbabilities, goals: rawMarketProbabilities});
  // Confidence-aware shrinkage: extreme probabilities must be earned by
  // sufficient, mutually supporting evidence. With sparse/partial data, pull
  // 1X2 probabilities toward the league-neutral 1/3 prior instead of allowing
  // a tiny sample to create artificial 80-90% confidence.
  const calibratedMatchProbabilities = calibrated.match;
  const calibratedMarketProbabilities = calibrated.goals;
  const smOverallSample = Math.min(sportmonksHistorical?.rawHome?.sample || 0, sportmonksHistorical?.rawAway?.sample || 0);
  const smVenueSample = Math.min(sportmonksHistorical?.home?.sample || 0, sportmonksHistorical?.away?.sample || 0);
  const playedSample = Math.min(Number(homeForm?.played || 0), Number(awayForm?.played || 0));
  // Evidence coverage is counted by independent signal families, not by
  // provider endpoints. Home/away form and advanced stats can describe the
  // same completed matches, so counting each endpoint separately inflated
  // confidence when one underlying sample was duplicated across providers.
  const evidenceFamilies = {
    form: playedSample > 0,
    table: standingsTable.length > 0,
    chanceQuality: smOverallSample > 0 || (homeAdvanced?.sample > 0 && awayAdvanced?.sample > 0),
    persistentPower: Boolean(persistedHomePower && persistedAwayPower)
  };
  const sourceCoverage = Object.values(evidenceFamilies).filter(Boolean).length / Object.keys(evidenceFamilies).length;
  const dataHealthScore = Math.round(sourceCoverage*100);
  const sampleStrength = Math.min(1, Math.max(playedSample / 8, smOverallSample / 10));
  const venueStrength = smVenueSample > 0 ? Math.min(1, smVenueSample / 6) : Math.min(1, playedSample / 8);
  const healthStrength = Math.max(.25, Math.min(1, dataHealthScore / 80));
  // Missing samples stay missing: they lower confidence rather than being
  // silently treated as zero-valued performance.
  const evidenceStrength = Math.max(.35, Math.min(1, .45 * sampleStrength + .25 * venueStrength + .30 * healthStrength));
  const norm3=v=>{const s=v.reduce((a,b)=>a+b,0)||1;return v.map(x=>100*x/s);};
  const dcVector=[Number(calibratedMatchProbabilities.homeWinProbability),Number(calibratedMatchProbabilities.drawProbability),Number(calibratedMatchProbabilities.awayWinProbability)];
  const eloHome=50 + 24*eloAdjustment.gap, eloAway=50-24*eloAdjustment.gap;
  const eloVector=norm3([Math.max(12,eloHome),28,Math.max(12,eloAway)]);
  const tableVector=norm3([Math.max(12,50+22*strengthGap),28,Math.max(12,50-22*strengthGap)]);
  const vectors=[dcVector,eloVector,tableVector].filter(v=>v.every(Number.isFinite));
  const consensus=vectors.length?vectors[0].map((_,i)=>vectors.reduce((s,v)=>s+v[i],0)/vectors.length):[33.33,33.34,33.33];
  const disagreement=vectors.length?vectors.reduce((s,v)=>s+v.reduce((z,x,i)=>z+Math.abs(x-consensus[i]),0)/3,0)/vectors.length:0;
  const agreementScore=Math.max(0,Math.min(100,100-disagreement*3.2));
  const analysisStrength=Math.round(Math.max(25,Math.min(100,evidenceStrength*75+agreementScore*.25)));
  const shrink3 = probs => {
    const h=Number(probs?.homeWinProbability), d=Number(probs?.drawProbability), a=Number(probs?.awayWinProbability);
    if (![h,d,a].every(Number.isFinite)) return probs;
    const effectiveStrength=Math.max(.30,Math.min(1,evidenceStrength*(.65+.35*agreementScore/100)));
    const vals=[h,d,a].map(p => 33.333 + effectiveStrength * (p - 33.333));
    const sum=vals.reduce((s,x)=>s+x,0) || 100;
    return { ...probs, homeWinProbability:+(vals[0]*100/sum).toFixed(1), drawProbability:+(vals[1]*100/sum).toFixed(1), awayWinProbability:+(vals[2]*100/sum).toFixed(1) };
  };
  // Binary markets (O/U, BTTS) must not inherit the 1X2 agreement score.
  // Until each binary market has its own independent agreement model, shrink
  // only by evidence/data strength.
  const shrinkBinary = (obj,key) => {
    const p=Number(obj?.[key]); if(!Number.isFinite(p)) return obj;
    const binaryStrength=Math.max(.30,Math.min(1,evidenceStrength));
    return { ...obj, [key]: +(50 + binaryStrength*(p-50)).toFixed(1) };
  };
  const matchProbabilities = shrink3(calibratedMatchProbabilities);
  let marketProbabilities = shrinkBinary(calibratedMarketProbabilities,'over25GoalsPercent');
  marketProbabilities = shrinkBinary(marketProbabilities,'bttsPercent');
  // New team/total scoring markets use the same evidence-strength guard until
  // each market has enough settled history for its own learned calibration.
  const shrinkPercent = p => Number.isFinite(Number(p)) ? +(50 + Math.max(.30,Math.min(1,evidenceStrength))*(Number(p)-50)).toFixed(1) : p;
  if (marketProbabilities.totalGoals) {
    marketProbabilities.totalGoals=Object.fromEntries(Object.entries(marketProbabilities.totalGoals).map(([line,v])=>[line,{over:shrinkPercent(v.over),under:shrinkPercent(v.under)}]));
  }
  if (marketProbabilities.teamGoals) {
    marketProbabilities.teamGoals=Object.fromEntries(Object.entries(marketProbabilities.teamGoals).map(([side,lines])=>[side,Object.fromEntries(Object.entries(lines).map(([line,v])=>[line,{over:shrinkPercent(v.over),under:shrinkPercent(v.under)}]))]));
  }
  if (marketProbabilities.scoring) marketProbabilities.scoring={home:shrinkPercent(marketProbabilities.scoring.home),away:shrinkPercent(marketProbabilities.scoring.away)};
  const cornerProjection = accuracy.cornerProjection(homeAdvanced, awayAdvanced);
  const smHome = sportmonksHistorical?.home;
  const smAway = sportmonksHistorical?.away;
  const ha = smHome?.averages || {}, aa = smAway?.averages || {};
  const smCornerReady = Number.isFinite(ha.corners) && Number.isFinite(aa.corners) && smHome.sample >= 5 && smAway.sample >= 5;
  const cornerPressure = a => {
    const parts = [];
    if (Number.isFinite(a.shots)) parts.push([a.shots / 13, .25]);
    if (Number.isFinite(a.blockedShots)) parts.push([a.blockedShots / 3.5, .30]);
    if (Number.isFinite(a.dangerousAttacks)) parts.push([a.dangerousAttacks / 45, .30]);
    if (Number.isFinite(a.shotsInsideBox)) parts.push([a.shotsInsideBox / 7, .15]);
    const w = parts.reduce((s,p)=>s+p[1],0);
    return w ? parts.reduce((s,p)=>s+p[0]*p[1],0)/w : 1;
  };
  let smExpectedHome = null, smExpectedAway = null;
  if (smCornerReady) {
    const baseHome = Number.isFinite(aa.cornersAgainst) ? (ha.corners + aa.cornersAgainst) / 2 : ha.corners;
    const baseAway = Number.isFinite(ha.cornersAgainst) ? (aa.corners + ha.cornersAgainst) / 2 : aa.corners;
    // Pressure is only a bounded supporting adjustment; observed corner for/against
    // remains the primary signal.
    smExpectedHome = +(baseHome * Math.max(.90, Math.min(1.10, cornerPressure(ha)))).toFixed(2);
    smExpectedAway = +(baseAway * Math.max(.90, Math.min(1.10, cornerPressure(aa)))).toFixed(2);
  }
  const cornerMetrics = smCornerReady
    ? Object.assign(poisson.estimateCornerMetricsFromExpected(smExpectedHome, smExpectedAway), { sample: Math.min(smHome.sample,smAway.sample), source:'sportmonks-history-pressure', expectedHome:smExpectedHome, expectedAway:smExpectedAway })
    : cornerProjection
    ? Object.assign(poisson.estimateCornerMetricsFromExpected(cornerProjection.homeExpected, cornerProjection.awayExpected), { sample: cornerProjection.sample })
    : Object.assign(poisson.estimateCornerMetrics(homeLambda, awayLambda), { source: 'league-prior-bounded-tempo', lowEvidence:true });
  const halfEvidence = (() => {
    if (!sportmonksHistorical) return null;
    const H=sportmonksHistorical.home?.averages||{}, A=sportmonksHistorical.away?.averages||{};
    const avg=(x,y)=>Number.isFinite(x)&&Number.isFinite(y)?(x+y)/2:(Number.isFinite(x)?x:(Number.isFinite(y)?y:null));
    const homeFirst=avg(H.firstHalfScored,A.firstHalfConceded);
    const homeSecond=avg(H.secondHalfScored,A.secondHalfConceded);
    const awayFirst=avg(A.firstHalfScored,H.firstHalfConceded);
    const awaySecond=avg(A.secondHalfScored,H.secondHalfConceded);
    if (![homeFirst,homeSecond,awayFirst,awaySecond].some(Number.isFinite)) return null;
    return {
      source:'sportmonks-verified-halftime',
      homeFirstRate:homeFirst, homeSecondRate:homeSecond,
      awayFirstRate:awayFirst, awaySecondRate:awaySecond,
      homeSample:sportmonksHistorical.home?.sample||0,
      awaySample:sportmonksHistorical.away?.sample||0
    };
  })();
  const halfMarkets = poisson.calculateHalfMarkets(homeLambda, awayLambda, halfEvidence);

  const oddsRaw = oddsResult.status === 'fulfilled' && oddsResult.value.ok
    ? oddsResult.value.data
    : null;
  const primaryMatchOdds = (oddsRaw && homeTeamName && awayTeamName)
    ? oddsApi.extractMatchOdds(oddsRaw, homeTeamName, awayTeamName)
    : null;
  // Full verified price board is kept separate from the probability model.
  // It is used by the Top Picks value selector (1X2 + O/U 2.5 today);
  // markets without a real quoted price are never labelled as betting value.
  const marketOddsBoard = (oddsRaw && homeTeamName && awayTeamName)
    ? oddsApi.extractMatchMarketOdds(oddsRaw, homeTeamName, awayTeamName)
    : null;
  // Football-Data is an additive, fail-open fallback. It is used only when
  // the existing odds provider has no match and both team names match exactly
  // after normalization. Any fetch/rate-limit/parse failure returns null.
  const footballDataMatchOdds = (!primaryMatchOdds && homeTeamName && awayTeamName)
    ? await footballDataOdds.getMatchOdds(homeTeamName, awayTeamName)
    : null;
  const matchOdds = primaryMatchOdds || footballDataMatchOdds;
  const proportionalMarket = oddsApi.normalizeImpliedProbabilities(matchOdds);
  const shinMarket = oddsApi.shinImpliedProbabilities(matchOdds);
  const marketImpliedProbabilities = shinMarket || proportionalMarket;
  const divergence = oddsApi.marketDivergence(matchProbabilities,marketImpliedProbabilities);
  // Large unexplained disagreement lowers model weight rather than being advertised as automatic value.
  const divergencePenalty = divergence?.material ? Math.min(.12,Math.abs(divergence.largestGap)/100*.35) : 0;
  const v2ModelWeight = marketImpliedProbabilities ? Math.max(.43,Math.min(.78,.38 + .40*evidenceStrength-divergencePenalty)) : 1;
  const blendedMatchProbabilities = oddsApi.blendWithMarket(matchProbabilities, marketImpliedProbabilities, v2ModelWeight);

  const homeFirstHalf = isSuperLig
    ? { firstHalfScoringRate: null }
    : stats.calculateFirstHalfTendency(homeFixtures, homeTeamIdForStats);
  const awayFirstHalf = isSuperLig
    ? { firstHalfScoringRate: null }
    : stats.calculateFirstHalfTendency(awayFixtures, awayTeamIdForStats);
  const derivedH2HFixtures = useDerivedH2H
    ? stats.deriveH2HFromFixtures(homeFixtures, awayFixtures, homeTeamIdForStats, awayTeamIdForStats)
    : [];
  const h2hFixturesRaw = useDerivedH2H
    ? derivedH2HFixtures
    : (h2hResult.status === 'fulfilled' && h2hResult.value.ok ? h2hResult.value.data?.response || [] : []);
  const h2hFirstHalf = stats.calculateH2HFirstHalfTendency(h2hFixturesRaw, homeTeamIdForStats, awayTeamIdForStats);
  const firstHalfProximity = stats.combineFirstHalfProximity(
    homeFirstHalf.firstHalfScoringRate,
    awayFirstHalf.firstHalfScoringRate,
    h2hFirstHalf
  );

  const h2hSucceeded = useDerivedH2H
    ? h2hFixturesRaw.length > 0
    : (h2hResult.status === 'fulfilled' && h2hResult.value.ok);
  const successCount = [oddsResult, injuriesResult, homeFixturesResult, awayFixturesResult].filter(
    r => r.status === 'fulfilled' && r.value.ok !== false
  ).length + (h2hSucceeded ? 1 : 0);
  const dataQualityScore = poisson.calculateDataQualityScore(successCount, 5, 0);

  const premium = premiumIntelligence.buildPremiumIntelligence({
    modelProbabilities: matchProbabilities,
    marketProbabilities: marketImpliedProbabilities,
    matchOdds,
    homePlayed: homeForm.played,
    awayPlayed: awayForm.played,
    hasStandings: standingsTable.length > 0,
    injuriesAvailable: injuriesResult.status === 'fulfilled' && injuriesResult.value.ok === true,
    h2hCount: h2hFixturesRaw.length,
    homeLambda,
    awayLambda,
    homeForm,
    awayForm,
  });

  const strongestSignal = poisson.findStrongestSignal([
    { label: '2.5 Ust Gol', probability: marketProbabilities.over25GoalsPercent },
    { label: 'KG Var', probability: marketProbabilities.bttsPercent },
    { label: 'Ev 1.5 Ust Takim Golü', probability: marketProbabilities.teamGoals?.home?.['1.5']?.over || 0 },
    { label: 'Dep 1.5 Ust Takim Golü', probability: marketProbabilities.teamGoals?.away?.['1.5']?.over || 0 },
    { label: 'Ev Gol Atar', probability: marketProbabilities.scoring?.home || 0 },
    { label: 'Dep Gol Atar', probability: marketProbabilities.scoring?.away || 0 },
  ]);
  // Market-specific SportMonks evidence. Keep the probability model intact,
  // but rank each market using the evidence that is actually relevant to it.
  // This prevents e.g. possession from boosting corners or raw shots from
  // overpowering BTTS/goal chance quality.
  const smMarketEvidence = (() => {
    if (!sportmonksHistorical) return null;
    const H=sportmonksHistorical.home?.averages||{}, A=sportmonksHistorical.away?.averages||{};
    const ratio=(x,base)=>Number.isFinite(x)?Math.max(.65,Math.min(1.35,x/base)):null;
    const weighted=parts=>{const ok=parts.filter(p=>p[0]!=null);const w=ok.reduce((s,p)=>s+p[1],0);return w?ok.reduce((s,p)=>s+p[0]*p[1],0)/w:null;};
    const attack=x=>weighted([[ratio(x.shotsOnTarget,4.5),.38],[ratio(x.bigChances,2.2),.30],[ratio(x.shotsInsideBox,7),.22],[ratio(x.shots,13),.10]]);
    const concede=x=>weighted([[ratio(x.shotsOnTargetAgainst,4.5),.38],[ratio(x.bigChancesAgainst,2.2),.30],[ratio(x.shotsInsideBoxAgainst,7),.22],[ratio(x.shotsAgainst,13),.10]]);
    const pressure=x=>weighted([[ratio(x.corners,5),.45],[ratio(x.blockedShots,3.5),.20],[ratio(x.dangerousAttacks,45),.20],[ratio(x.shotsInsideBox,7),.15]]);
    const hAtk=attack(H),aAtk=attack(A),hCon=concede(H),aCon=concede(A);
    const homeThreat=weighted([[hAtk,.65],[aCon,.35]]);
    const awayThreat=weighted([[aAtk,.65],[hCon,.35]]);
    const goalQuality=weighted([[homeThreat,.5],[awayThreat,.5]]);
    const bttsQuality=(homeThreat!=null&&awayThreat!=null)?Math.sqrt(homeThreat*awayThreat):null;
    const cornerQuality=weighted([[pressure(H),.5],[pressure(A),.5]]);
    const sample=Math.min(sportmonksHistorical.home?.sample||0,sportmonksHistorical.away?.sample||0);
    return { homeThreat, awayThreat, goalQuality, bttsQuality, cornerQuality, sample, venueSplit:true };
  })();

  const marketBoard = premiumIntelligence.buildMarketBoard({
    modelProbabilities: matchProbabilities,
    goalMarkets: marketProbabilities,
    cornerMetrics,
    advancedStats: { home: homeAdvanced, away: awayAdvanced, leagueBaseline: leagueBase },
    dataHealth: premium.dataHealth,
    premium,
    halfMarkets,
    sportmonksMarketEvidence: smMarketEvidence,
    evidenceStrength,
    modelAgreementScore: agreementScore,
    marketOddsBoard,
  });

  return {
    fixtureId,
    homeLambda,
    awayLambda,
    matchProbabilities: blendedMatchProbabilities,
    modelOnlyProbabilities: matchProbabilities,
    rawModelProbabilities: rawMatchProbabilities,
    rawMarketProbabilities,
    calibrationApplied: calibrated.applied,
    calibrationVersion: calibrated.calibrationVersion || modelCalibration.CALIBRATION_VERSION,
      confidenceShrinkage: { evidenceStrength:+evidenceStrength.toFixed(3), playedSample, sportmonksOverallSample:smOverallSample, sportmonksVenueSample:smVenueSample, dataHealthScore },
    marketImpliedProbabilities,
    marketProbabilities,
    cornerMetrics,
    halfMarkets,
    firstHalfProximity,
    dataQualityScore,
    strongestSignal,
    marketBoard,
    premium,
    injuries,
    homeAwayForm: homeAwaySplit,
    motivation: { home: motivationHome, away: motivationAway },
    fatigue: {
      home: { restDays: homeRestDays, multiplier: homeFatigue },
      away: { restDays: awayRestDays, multiplier: awayFatigue },
    },
    streak: {
      home: homeStreak,
      away: awayStreak,
    },
    homeAdvantageMultiplier,
    standings: {
      table: standingsTable,
      homeTeamId: homeTeamIdForStats,
      awayTeamId: awayTeamIdForStats,
    },
    h2h: useDerivedH2H
      ? { ok: true, derived: true, data: { response: derivedH2HFixtures } }
      : (h2hResult.status === 'fulfilled' ? h2hResult.value : null),
    odds: oddsResult.status === 'fulfilled' ? oddsResult.value : null,
    marketOdds: matchOdds,
    marketOddsBoard,
    marketOddsSource: primaryMatchOdds ? 'existing-provider' : (footballDataMatchOdds ? 'football-data.co.uk' : null),
    sportmonksHistorical,
    sportmonksMarketEvidence: smMarketEvidence,
    modelDiagnostics: {
      lambdas: { homeBase: homeLambdaBase, awayBase: awayLambdaBase, finalHome: homeLambda, finalAway: awayLambda },
      form: { home: homeForm, away: awayForm },
      standings: { homeRank: standingsTable.find(x=>String(x.teamId)===String(homeTeamIdForStats))?.rank ?? null, awayRank: standingsTable.find(x=>String(x.teamId)===String(awayTeamIdForStats))?.rank ?? null },
      multipliers: { homeAdvantage: homeAdvantageMultiplier, homeMotivation: motivationHome.multiplier, awayMotivation: motivationAway.multiplier, homeFatigue, awayFatigue, homeStreak:homeStreakMult, awayStreak:awayStreakMult },
      sportmonks: smMarketEvidence,
      calibrationApplied: calibrated.applied,
      architecture:'analysis-v3-market-ensemble',
      dixonColes:{ rho:+fittedRho.toFixed(4), leagueEstimate:leagueDc, reliability:+dcReliability.toFixed(3), dynamicHomeMultiplier:+dynamicHome.toFixed(4) },
      powerRating:{ homeElo, awayElo, homeGames:homeEloGames, awayGames:awayEloGames, persistent:Boolean(persistedHomePower||persistedAwayPower), homePersistent:Boolean(persistedHomePower), awayPersistent:Boolean(persistedAwayPower), homeStoredTeamId:persistedHomePower?.teamId||null, awayStoredTeamId:persistedAwayPower?.teamId||null, homeIdentityMatch:persistedHomePower ? (persistedHomePower._identityMatch || (String(persistedHomePower.teamId)===String(homeTeamIdForStats)?'id':'stored')) : null, awayIdentityMatch:persistedAwayPower ? (persistedAwayPower._identityMatch || (String(persistedAwayPower.teamId)===String(awayTeamIdForStats)?'id':'stored')) : null, adjustment:eloAdjustment },
      powerComponents,
      modelAgreement:{ score:+agreementScore.toFixed(1), disagreement:+disagreement.toFixed(2), dixonColes:dcVector.map(x=>+x.toFixed(1)), elo:eloVector.map(x=>+x.toFixed(1)), standings:tableVector.map(x=>+x.toFixed(1)) },
      analysisStrength:{ score:analysisStrength, sampleStrength:+sampleStrength.toFixed(3), venueStrength:+venueStrength.toFixed(3), sourceCoverage:+sourceCoverage.toFixed(3), evidenceFamilies, playedSample, sportmonksOverallSample:smOverallSample, sportmonksVenueSample:smVenueSample },
      ensemble:{ modelWeight:+v2ModelWeight.toFixed(3), marketWeight:+(1-v2ModelWeight).toFixed(3), marketAvailable:Boolean(marketImpliedProbabilities), deVigMethod:marketImpliedProbabilities?.method||'normalized-overround', divergence, proportional:proportionalMarket, shin:shinMarket },
      probabilityPipeline:['venue-recent-form','opponent-strength','independent-evidence-ensemble','mismatch-preservation','dixon-coles','market-calibration','evidence-shrinkage','market-ensemble'],
      probabilities: { raw:rawMatchProbabilities, calibrated:calibratedMatchProbabilities, confidenceAdjusted:matchProbabilities, marketBlended:blendedMatchProbabilities }
    },
    dataSource: isSuperLig ? 'tff' : (isMappedLeague ? 'thesportsdb' : 'unavailable'),
  };
}

module.exports = { computeFullAnalysis, LEAGUE_AVG_HOME_GOALS, LEAGUE_AVG_AWAY_GOALS };
