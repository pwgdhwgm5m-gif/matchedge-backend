const express = require('express');
const router = express.Router();
const cache = require('../utils/cache');
const config = require('../config/config');
const sportsDb = require('../services/sportsDbService');
const liveXg = require('../services/liveXgService');
const bsdService = require('../services/bsdService');
const footballDataOrg = require('../services/footballDataOrgService');
const sportmonks = require('../services/sportmonksService');
const competitionRegistry = require('../services/competitionRegistryService');
const { acceptsLiveFixture, providerKey } = require('../services/liveFixtureIdentity');
const providerIdentity = require('../services/providerIdentityCache');

const quickBound = (promise, fallback, ms = 2500) => Promise.race([
  promise,
  new Promise(resolve => setTimeout(() => resolve(fallback), ms))
]);

/**
 * GET /api/live
 * Su an oynanan tum maclarin listesi.
 * ONCE TheSportsDB'nin GERCEK canli skor endpoint'i (V2 livescore) denenir -
 * bu, gercek dakika (strProgress) ve gercek periyot (1H/HT/2H) verir.
 * Eskiden burada eventsday.php (gunun tum fikstur listesi) filtrelenerek
 * kullaniliyordu - o endpoint dakika bilgisi vermiyordu (hep null donuyordu)
 * ve "canli mi" tespiti gevsekti (dun oynanmis bitmis bir mac bile yanlislikla
 * canli gorunebiliyordu). V2 basarisiz olursa eski yontem yedek olarak devrede.
 */
router.get('/', async (req, res) => {
  // Build one live feed instead of returning early from TheSportsDB. SportMonks
  // owns the six subscribed leagues; BSD supplies live rows outside them.
  const [tsdbLive,smLive,bsdLive]=await Promise.all([
    quickBound(cache.getOrFetch('live:v2:all',config.cache.ttlLive,()=>sportsDb.getLiveScores()),{ok:false,error:'live_lookup_timeout'}),
    quickBound(cache.getOrFetch('sportmonks:inplay',30,()=>sportmonks.getInplay()),{ok:false,error:'sportmonks_timeout'}),
    quickBound(cache.getOrFetch('bsd:fixture-live:canonical',60,()=>bsdService.getLiveResultMatches()),{ok:false,error:'bsd_live_timeout'})
  ]);
  const candidates=[];
  const addMatch=rawMatch=>{
    const match=competitionRegistry.decorateMatch(
      rawMatch,
      rawMatch?.canonicalProvider||rawMatch?.source||rawMatch?.dataSource
    );
    candidates.push(match);
  };
  if(tsdbLive.ok){
    for(const e of (tsdbLive.data?.livescore||[])){
      if(String(e.strSport||'').toLowerCase()!=='soccer')continue;
      const m=sportsDb.transformLiveEvent(e);
       if(m?.isLive&&sportsDb.isWhitelistedLeague(m.leagueId)&&
          sportsDb.isLeagueIdentityConsistent(m.leagueId,m.league))
         addMatch({...m,canonicalProvider:'thesportsdb',providerIds:{sportsdb:String(m.fixtureId)}});
    }
  }
  if(bsdLive.ok){
    for(const m of (bsdLive.matches||[])){
       if(m?.isLive)addMatch({...m,canonicalProvider:'bsd',providerIds:{bsd:String(m.bsdEventId||m.fixtureId)}});
    }
  }
  if(smLive.ok){
    for(const sm of (smLive.fixtures||[])){
      if(!sm.isLive)continue;
       const m={fixtureId:String(sm.sportmonksId),sportmonksId:sm.sportmonksId,leagueId:sm.leagueId,league:sm.leagueName,homeTeam:sm.homeTeam,awayTeam:sm.awayTeam,homeScore:sm.homeScore,awayScore:sm.awayScore,halftimeHome:sm.halftimeHome,halftimeAway:sm.halftimeAway,kickoff:sm.kickoff,minute:sm.minute,statusShort:sm.statusShort||'LIVE',isLive:true,canonicalProvider:'sportmonks',providerIds:{sportmonks:String(sm.sportmonksId)},dataSource:'sportmonks'};
       addMatch(m);
    }
  }
  const matches=competitionRegistry.dedupeCompetitionFixtures(candidates,{
    toleranceMs:6*60*60*1000,preferBsd:true
  }).filter(match => match?.visibleInCompetitionFilter === true);
  for(const match of matches)providerIdentity.remember(match).catch(err=>console.warn('[provider-identity/live]',err.message));
  return res.json({matches,source:'canonical-live-merged',counts:{thesportsdb:tsdbLive.ok?(tsdbLive.data?.livescore||[]).length:0,sportmonks:smLive.ok?(smLive.fixtures||[]).filter(x=>x.isLive).length:0,bsd:bsdLive.ok?(bsdLive.matches||[]).length:0}});
});

/**
 * GET /api/live/:fixtureId
 * Tek bir mac icin canli skor bilgisi. Once V2 canli skor listesinde aranir
 * (gercek dakika buradan gelir), bulunamazsa eski yontemle (eventsday.php)
 * aranir. Artik gercek istatistik (sut, korner, top hakimiyeti, xG), mac
 * zaman cizelgesi (gol/kart/degisiklik), kadrolar, TV yayin bilgisi ve
 * one cikanlar (highlights) da TheSportsDB Pro'dan cekiliyor - kucuk
 * liglerde bu ek veriler bulunmayabilir, o durumda ilgili alanlar bos
 * doner ama skor/dakika/takim bilgisi her zaman gercek ve gunceldir.
 */
router.get('/:fixtureId', async (req, res) => {
  const { fixtureId } = req.params;
  const identity = req.query;
  const accepts = (candidate, provider) => acceptsLiveFixture(candidate, provider, identity);
  const allows = provider => !providerKey(identity.provider) || providerKey(identity.provider) === provider;
  const withTsdbIdentity = candidate => ({...candidate,canonicalProvider:'sportsdb',dataSource:'thesportsdb',
    providerIds:{sportsdb:String(fixtureId)}});

  const liveResult = allows('sportsdb')
    ? await cache.getOrFetch('live:v2:all', config.cache.ttlLive, () => sportsDb.getLiveScores())
    : {ok:false};

  let match = null;
  let fromCacheFlag = false;

  if (liveResult.ok) {
    const rawLive = liveResult.data?.livescore || [];
    const liveMatch=e=>{const transformed=sportsDb.transformLiveEvent(e);return { ...transformed, kickoff:transformed.kickoff ||
      (e.strTimestamp ? sportsDb.toUtcIso(e.strTimestamp) : null) };};
    const rawMatch = allows('sportsdb') && rawLive.find(e => String(e.idEvent) === String(fixtureId) && accepts(liveMatch(e),'sportsdb'));
    if (rawMatch) {
      match = withTsdbIdentity(liveMatch(rawMatch));
      fromCacheFlag = liveResult.fromCache;
    }
  }

  if (!match && allows('sportsdb')) {
    const today = new Date().toISOString().split('T')[0];
    const result = await quickBound(
      cache.getOrFetch(`live:all:${today}`, config.cache.ttlLive, () => sportsDb.getMatchesByDate(today)),
      { ok:false, error:'date_lookup_timeout' }
    );

    if (result.ok) {
      const rawEvents = result.data?.events || [];
      const raw = allows('sportsdb') && rawEvents.find(e => String(e.idEvent) === String(fixtureId) && accepts(sportsDb.transformEvent(e),'sportsdb'));
      if (raw) {
        match = withTsdbIdentity(sportsDb.transformEvent(raw));
        fromCacheFlag = result.fromCache;
      }
    }
  }

  if (!match && allows('bsd')) {
    const directBsd = await quickBound(
      bsdService.getEventById(fixtureId),
      { available:false, error:'bsd_event_timeout' },
      2800
    );
    if (directBsd.available && accepts(directBsd.match,'bsd')) {
      match = { ...directBsd.match, canonicalProvider:'bsd', dataSource:'bsd' };
    } else {
      const bsdDirect = await quickBound(
        cache.getOrFetch('bsd:live:canonical',60,()=>bsdService.getLiveFootballEvents()),
        {ok:false},
        2800
      );
      if (bsdDirect.ok) {
        const raw = bsdService.extractList(bsdDirect.data)
          .find(e=>String(bsdService.getEventId(e))===String(fixtureId) && accepts(bsdService.eventToResultMatch(e),'bsd'));
        if (raw) {
          match={...bsdService.eventToResultMatch(raw),canonicalProvider:'bsd',dataSource:'bsd',providerIds:{bsd:String(fixtureId)}};
          fromCacheFlag=bsdDirect.fromCache;
        }
      }
    }
  }

  // A fixture can legitimately be absent from the provider's compact live/day
  // feeds (especially lower leagues/cups). Resolve the canonical event directly
  // before declaring it missing.
  if (!match && allows('sportsdb')) {
    const direct = await quickBound(
      cache.getOrFetch(`tsdb-event:${fixtureId}`, 60, () => sportsDb.getEventById(fixtureId)),
      { ok:false, error:'event_lookup_timeout' }
    );
    if (direct.ok) {
      const raw = direct.data?.events?.[0] || direct.data?.event?.[0] || direct.data?.event || null;
      if (raw && String(raw.idEvent) === String(fixtureId) && accepts(sportsDb.transformEvent(raw),'sportsdb')) {
        match = withTsdbIdentity(sportsDb.transformEvent(raw));
        fromCacheFlag = direct.fromCache;
      }
    }
  }

  // SportMonks fixture ids are different from TheSportsDB ids. For subscribed
  // leagues, resolve an in-play fixture by its canonical SportMonks id as a
  // second direct path rather than relying on team-name matching.
  if (!match && allows('sportmonks')) {
    const smDirect = await quickBound(
      cache.getOrFetch('sportmonks:inplay', 30, () => sportmonks.getInplay()),
      { ok:false, error:'sportmonks_timeout' }
    );
    if (smDirect.ok) {
      const sm = (smDirect.fixtures || []).find(x => String(x.sportmonksId) === String(fixtureId) && accepts({homeTeam:x.homeTeam,awayTeam:x.awayTeam,kickoff:x.kickoff,league:x.leagueName},'sportmonks'));
      if (sm) {
        match = {
          fixtureId:String(sm.sportmonksId), sportmonksId:sm.sportmonksId,
          leagueId:sm.leagueId, league:sm.leagueName,
          homeTeam:sm.homeTeam, awayTeam:sm.awayTeam,
          homeScore:sm.homeScore, awayScore:sm.awayScore,
          halftimeHome:sm.halftimeHome, halftimeAway:sm.halftimeAway,
          kickoff:sm.kickoff, minute:sm.minute, statusShort:sm.statusShort,
          isLive:!!sm.isLive, dataSource:'sportmonks',canonicalProvider:'sportmonks',providerIds:{sportmonks:String(sm.sportmonksId)}
        };
        fromCacheFlag = smDirect.fromCache;
      }
    }
  }

  if (!match) {
    return res.status(404).json({ error: 'Mac bulunamadi' });
  }
  match=competitionRegistry.decorateMatch(
    match,
    match.canonicalProvider||match.source||match.dataSource
  );
  // Every provider endpoint receives only an ID established for that provider.
  // A matching name alone never turns a BSD event ID into a SportsDB ID.
  const known=await providerIdentity.lookup(match).catch(()=>null);
  match.providerIds={...(known?.providerIds||{}),...(match.providerIds||{})};
  match.providerTeamIds={...(known?.providerTeamIds||{}),...(match.providerTeamIds||{})};
  if(!match.providerIds.bsd && providerKey(match.canonicalProvider)!=='bsd'){
    const liveBsd=await quickBound(cache.getOrFetch('bsd:fixture-live:canonical',60,()=>bsdService.getLiveResultMatches()),{ok:false},2800);
    const candidates=(liveBsd.ok?liveBsd.matches:[]).filter(row=>acceptsLiveFixture(row,'bsd',{
      homeTeamName:match.homeTeam,awayTeamName:match.awayTeam,
      leagueName:match.league,kickoff:match.kickoff||match.date}));
    if(candidates.length===1){
      match.providerIds.bsd=String(candidates[0].bsdEventId);
      match.providerTeamIds.bsd={home:candidates[0].homeTeamId||null,away:candidates[0].awayTeamId||null};
      match.bsdLiveStats=candidates[0].liveStats||null;
      providerIdentity.remember(match).catch(err=>console.warn('[provider-identity/alias]',err.message));
    }
  }
  const tsdbExtrasId = match.providerIds.sportsdb || match.providerIds.thesportsdb || null;

  // --- Pro/Premium V2 ek veriler: zaman cizelgesi, istatistik, kadro, TV, highlights ---
  // Bitmis maclarda bu veri degismeyecegi icin uzun (6 saat) cache'leniyor;
  // canli maclarda kotayi korumak icin orta sureli (60 sn) cache'leniyor.
  // Kucuk liglerdeki maclarda bu veriler genelde bulunmuyor - o durumda
  // asagidaki *Result.available alanlari false donuyor, hicbir sey kirilmiyor.
  const isFinished = match.statusShort === 'FT';
  const extrasTtl = isFinished ? 60 * 60 * 6 : 60;

  const bounded = (promise, fallback, ms = 2800) => Promise.race([
    promise,
    new Promise(resolve => setTimeout(() => resolve(fallback), ms))
  ]);
  const [timelineResult, statsResult, lineupResult, tvResult, highlightsResult] = await Promise.all([
    tsdbExtrasId ? bounded(cache.getOrFetch(`tsdb-timeline:${tsdbExtrasId}`, extrasTtl, () => sportsDb.getEventTimelineFormatted(tsdbExtrasId)), {available:false,events:[],timeout:true}) : {available:false,events:[]},
    tsdbExtrasId ? bounded(cache.getOrFetch(`tsdb-stats:${tsdbExtrasId}`, extrasTtl, () => sportsDb.getEventStatsFormatted(tsdbExtrasId)), {available:false,stats:{},timeout:true}) : {available:false,stats:{}},
    tsdbExtrasId ? bounded(cache.getOrFetch(`tsdb-lineup:${tsdbExtrasId}`, extrasTtl, () => sportsDb.getEventLineupFormatted(tsdbExtrasId)), {available:false,timeout:true}) : {available:false},
    tsdbExtrasId ? bounded(cache.getOrFetch(`tsdb-tv:${tsdbExtrasId}`, extrasTtl, () => sportsDb.getEventTVFormatted(tsdbExtrasId)), {available:false,broadcasts:[],timeout:true}) : {available:false,broadcasts:[]},
    tsdbExtrasId ? bounded(cache.getOrFetch(`tsdb-highlights:${tsdbExtrasId}`, extrasTtl, () => sportsDb.getEventHighlightsFormatted(tsdbExtrasId)), {available:false,timeout:true}) : {available:false},
  ]);

  const stats = statsResult.available ? statsResult.stats : {};
  const smLiveDetail = await bounded(cache.getOrFetch('sportmonks:inplay', 30, () => sportmonks.getInplay()), {ok:false,error:'sportmonks_timeout'}, 2800);
  const smCandidate = smLiveDetail.ok ? sportmonks.findMatch(smLiveDetail.fixtures, match.homeTeam, match.awayTeam) : null;
  const smMatch = smCandidate && acceptsLiveFixture({homeTeam:smCandidate.homeTeam,awayTeam:smCandidate.awayTeam,
    kickoff:smCandidate.kickoff,league:smCandidate.leagueName},'sportmonks',{
    homeTeamName:match.homeTeam,awayTeamName:match.awayTeam,kickoff:match.kickoff||match.date,
    leagueName:match.league||match.displayName}) ? smCandidate : null;
  const smStats = smMatch?.stats || {};

  // Outside the six SportMonks-owned leagues BSD is the live-data owner too,
  // not merely an xG fallback. Resolve the canonical BSD event and consume its
  // /stats payload. Missing BSD fields remain null and can be filled by the
  // secondary provider; they are never converted to zero.
  const sportmonksOwned = Boolean(competitionRegistry.resolveCompetition(match)?.providerIds?.sportmonks);
  const bsdEventId=match.providerIds.bsd||null;
  const bsdLiveStats = bsdEventId
    ? await bounded(bsdService.getStatsByEventId(bsdEventId), {available:false,error:'bsd_timeout'}, 2800)
    : {available:false};
  const bsdPayload = bsdLiveStats.available ? (bsdLiveStats.data?.stats || bsdLiveStats.data?.data?.stats || bsdLiveStats.data || {}) :
    (match.bsdLiveStats || match.liveStats || {});
  const bsdHome = bsdPayload.home || {};
  const bsdAway = bsdPayload.away || {};
  const bsdNum = (side, keys) => {
    for (const key of keys) {
      const value = key.split('.').reduce((o,k)=>o && o[k] !== undefined ? o[k] : undefined, side);
      const n = Number(value);
      if (value !== null && value !== undefined && value !== '' && Number.isFinite(n)) return n;
    }
    return null;
  };
  const bsdHomeXg = bsdNum(bsdHome,['xg.actual','xg','expected_goals']);
  const bsdAwayXg = bsdNum(bsdAway,['xg.actual','xg','expected_goals']);
  const bsdXgEstimated = Boolean(bsdLiveStats.data?.xg_estimated || bsdHome?.xg?.estimated || bsdAway?.xg?.estimated);
  const statFirst=(sm,bsd)=>sportmonksOwned ? (sm??bsd) : (bsd??sm);

  // Canli xG/momentum/gol yakinligi hesabi icin iki takimin ham istatistiklerini
  // ortak sekle getiriyoruz. TheSportsDB "tehlikeli atak" ve "isabetsiz sut"
  // vermiyor, bu yuzden bu iki alan hep 0 - hesaplamalar geri kalan gercek
  // verilerle (isabetli sut, korner, varsa gercek xG) yapiliyor. Istatistik
  // henuz yoksa (mac yeni basladiysa) tum degerler 0 olur ve asagidaki
  // fonksiyonlar otomatik 50-50/0 donuyor - hicbir sey kirilmiyor.
  const homeRawStats = {
    shotsOnTarget: statFirst(smStats.shotsOnTargetHome,bsdNum(bsdHome,['shots_on_target','shotsOnTarget','shots.on_target'])) ?? (stats.shotsOnTarget?.home ?? null),
    shotsOffTarget: statFirst(smStats.shotsOffTargetHome,bsdNum(bsdHome,['shots_off_target','shotsOffTarget','shots.off_target'])) ?? ((smStats.shotsHome != null && smStats.shotsOnTargetHome != null) ? Math.max(0, smStats.shotsHome - smStats.shotsOnTargetHome) : null),
    corners: statFirst(smStats.cornersHome,bsdNum(bsdHome,['corners','corner_kicks'])) ?? (stats.corners?.home ?? null),
    dangerousAttacks: statFirst(smStats.dangerousAttacksHome,bsdNum(bsdHome,['dangerous_attacks','dangerousAttacks'])),
    attacks: statFirst(smStats.attacksHome,bsdNum(bsdHome,['attacks','total_attacks'])),
    blockedShots: statFirst(smStats.blockedShotsHome,bsdNum(bsdHome,['blocked_shots','blockedShots'])),
    shotsInsideBox: statFirst(smStats.shotsInsideBoxHome,bsdNum(bsdHome,['shots_inside_box','shotsInsideBox'])),
    bigChances: statFirst(smStats.bigChancesHome,bsdNum(bsdHome,['big_chances','bigChances'])),
  };
  const awayRawStats = {
    shotsOnTarget: statFirst(smStats.shotsOnTargetAway,bsdNum(bsdAway,['shots_on_target','shotsOnTarget','shots.on_target'])) ?? (stats.shotsOnTarget?.away ?? null),
    shotsOffTarget: statFirst(smStats.shotsOffTargetAway,bsdNum(bsdAway,['shots_off_target','shotsOffTarget','shots.off_target'])) ?? ((smStats.shotsAway != null && smStats.shotsOnTargetAway != null) ? Math.max(0, smStats.shotsAway - smStats.shotsOnTargetAway) : null),
    corners: statFirst(smStats.cornersAway,bsdNum(bsdAway,['corners','corner_kicks'])) ?? (stats.corners?.away ?? null),
    dangerousAttacks: statFirst(smStats.dangerousAttacksAway,bsdNum(bsdAway,['dangerous_attacks','dangerousAttacks'])),
    attacks: statFirst(smStats.attacksAway,bsdNum(bsdAway,['attacks','total_attacks'])),
    blockedShots: statFirst(smStats.blockedShotsAway,bsdNum(bsdAway,['blocked_shots','blockedShots'])),
    shotsInsideBox: statFirst(smStats.shotsInsideBoxAway,bsdNum(bsdAway,['shots_inside_box','shotsInsideBox'])),
    bigChances: statFirst(smStats.bigChancesAway,bsdNum(bsdAway,['big_chances','bigChances'])),
  };

  // Gercek xG oncelik sirasi: 1) TheSportsDB (Pro/Premium bazi buyuk
  // liglerde saglıyor) 2) BSD - Bzzoiro Sports Data (farkli bir lig/mac
  // kapsamı olabilir, kendi "estimated" bayragi false ise gercek sayilir)
  // 3) hicbiri yoksa sut/korner sayisindan kaba bir "canli xG" tahmini
  // (liveXgService.estimateLiveXg). BSD'ye sadece TheSportsDB'de gercek xG
  // YOKSA basvuruluyor - gereksiz istek atilmiyor.
  let homeLiveXg;
  let awayLiveXg;
  // xgSource: hangi kaynaktan geldigini disaridan (yanit uzerinden) dogrulayabilmek
  // icin eklendi - BSD entegrasyonunun gercekten devreye girip girmedigini
  // TheSportsDB'nin kendi gercek xG'sinden ayirt etmenin baska yolu yoktu.
  let xgSource;

  if (!sportmonksOwned && bsdHomeXg != null && bsdAwayXg != null && !bsdXgEstimated) {
    homeLiveXg = bsdHomeXg;
    awayLiveXg = bsdAwayXg;
    xgSource = 'bsd';
  } else if (stats.xg && stats.xg.home != null && stats.xg.away != null) {
    homeLiveXg = stats.xg.home;
    awayLiveXg = stats.xg.away;
    xgSource = 'thesportsdb';
  } else {
    const bsdXg = bsdEventId ? await bounded(bsdService.getEventXg(bsdEventId), {available:false,error:'bsd_timeout'}, 2200) : {available:false};
    if (bsdXg.available && !bsdXg.estimated) {
      homeLiveXg = bsdXg.home;
      awayLiveXg = bsdXg.away;
      xgSource = 'bsd';
    } else {
      const hx = liveXg.estimateLiveXg(homeRawStats);
      const ax = liveXg.estimateLiveXg(awayRawStats);
      homeLiveXg = hx.available ? hx.value : null;
      awayLiveXg = ax.available ? ax.value : null;
      xgSource = (hx.available || ax.available) ? 'estimate' : null;
    }
  }

  // Momentum: genel baski (isabetli sut + korner agirlikli).
  // Gol yakinligi: hangi takim gole daha yakin (isabetli sut + korner + canli xG,
  // xG en agirlikli faktor) - kullanicinin canli ekranda gordugu "kim daha yakin" barı.
  const momentum = liveXg.calculateMomentum(homeRawStats, awayRawStats);
  const bsdPossHome=bsdNum(bsdHome,['possession','ball_possession','possession_percentage']);
  const bsdPossAway=bsdNum(bsdAway,['possession','ball_possession','possession_percentage']);
  const possessionObserved = (!sportmonksOwned && bsdPossHome != null && bsdPossAway != null)
      ? {home:bsdPossHome,away:bsdPossAway}
    : (smStats.possessionHome != null && smStats.possessionAway != null)
      ? { home: smStats.possessionHome, away: smStats.possessionAway }
      : (stats.possession && stats.possession.home != null && stats.possession.away != null ? { home: stats.possession.home, away: stats.possession.away } : null);
  const redHome = smStats.redCardsHome ?? (stats.redCards ? stats.redCards.home : null);
  const redAway = smStats.redCardsAway ?? (stats.redCards ? stats.redCards.away : null);
  const goalProximity = liveXg.calculateGoalProximity(homeRawStats, awayRawStats, homeLiveXg, awayLiveXg, {
    possessionHome: possessionObserved?.home,
    possessionAway: possessionObserved?.away,
    redCardsHome: redHome,
    redCardsAway: redAway,
    minute: match.minute,
    homeScore: match.homeScore,
    awayScore: match.awayScore
  });
  const matchDominance = liveXg.calculateMatchDominance(homeRawStats, awayRawStats, {
    possessionHome: possessionObserved?.home,
    possessionAway: possessionObserved?.away,
    redCardsHome: redHome,
    redCardsAway: redAway,
    minute: match.minute,
    homeScore: match.homeScore,
    awayScore: match.awayScore
  });

  res.json({
    fixtureId,
    canonicalProvider: match.canonicalProvider || match.dataSource || null,
    providerIds: match.providerIds || {},
    kickoff: match.kickoff || match.date || null,
    league: match.league || match.leagueName || match.displayName || null,
    canonicalCompetitionKey: match.canonicalCompetitionKey,
    displayName: match.displayName,
    competitionCountry: match.competitionCountry,
    competitionType: match.competitionType,
    competitionPriority: match.competitionPriority,
    homePageRank: match.homePageRank,
    minute: match.minute,
    statusShort: match.statusShort,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    homeLiveXg,
    awayLiveXg,
    xgSource,
    momentum,
    goalProximity,
    matchDominance,
    possession: possessionObserved,
    liveStatsSource: !sportmonksOwned && (bsdLiveStats.available || match.bsdLiveStats || match.liveStats) ? 'bsd' : (smMatch ? 'sportmonks' : (statsResult.available ? 'thesportsdb' : null)),
    stats: {
      shotsOnTargetHome: homeRawStats.shotsOnTarget,
      shotsOnTargetAway: awayRawStats.shotsOnTarget,
      cornersHome: homeRawStats.corners,
      cornersAway: awayRawStats.corners,
      // TheSportsDB "tehlikeli atak" istatistigi vermiyor, gercek karsiligi yok.
      dangerousAttacksHome: homeRawStats.dangerousAttacks,
      dangerousAttacksAway: awayRawStats.dangerousAttacks,
      attacksHome: homeRawStats.attacks,
      attacksAway: awayRawStats.attacks,
      blockedShotsHome: homeRawStats.blockedShots,
      blockedShotsAway: awayRawStats.blockedShots,
      shotsInsideBoxHome: homeRawStats.shotsInsideBox,
      shotsInsideBoxAway: awayRawStats.shotsInsideBox,
      bigChancesHome: homeRawStats.bigChances,
      bigChancesAway: awayRawStats.bigChances,
      foulsHome: stats.fouls ? stats.fouls.home : null,
      foulsAway: stats.fouls ? stats.fouls.away : null,
      offsidesHome: stats.offsides ? stats.offsides.home : null,
      offsidesAway: stats.offsides ? stats.offsides.away : null,
      yellowCardsHome: stats.yellowCards ? stats.yellowCards.home : null,
      yellowCardsAway: stats.yellowCards ? stats.yellowCards.away : null,
      redCardsHome: redHome,
      redCardsAway: redAway,
    },
    statsAvailable: Boolean((smMatch && Object.values(smStats).some(v=>v!=null)) ||
      Object.values(homeRawStats).some(v=>v!=null) || Object.values(awayRawStats).some(v=>v!=null) || possessionObserved),
    timeline: timelineResult.available ? timelineResult.events : [],
    lineup: lineupResult.available
      ? { home: lineupResult.home, away: lineupResult.away, homeSubs: lineupResult.homeSubs, awaySubs: lineupResult.awaySubs }
      : null,
    tv: tvResult.available ? tvResult.broadcasts : [],
    highlightVideo: highlightsResult.available ? highlightsResult.videoUrl : null,
    // Stable live-card prediction payload. The frontend must never have to
    // dereference pre-match fields that are absent from /api/live/:fixtureId.
    livePrediction: (() => {
      const minute = Number(match.minute || 0);
      const homeSignal = goalProximity?.available ? goalProximity.home : (momentum?.available ? momentum.home : null);
      const awaySignal = goalProximity?.available ? goalProximity.away : (momentum?.available ? momentum.away : null);
      if (!Number.isFinite(homeSignal) || !Number.isFinite(awaySignal)) return { available:false, market:null, selection:null, probability:null, dataHealth:0 };
      const home = Number(homeSignal);
      const away = Number(awaySignal);
      const total = home + away;
      if (!Number.isFinite(home) || !Number.isFinite(away) || total <= 0) {
        return { available: false, market: null, selection: null, probability: null, dataHealth: null };
      }
      const hp = +(home / total * 100).toFixed(1);
      const ap = +(away / total * 100).toFixed(1);
      const selection = hp >= ap ? match.homeTeam : match.awayTeam;
      const probability = Math.max(hp, ap);
      const hasRealXg = xgSource === 'thesportsdb' || xgSource === 'bsd';
      const hasShots = Number(homeRawStats.shotsOnTarget) + Number(awayRawStats.shotsOnTarget) > 0;
      const hasCorners = Number(homeRawStats.corners) + Number(awayRawStats.corners) > 0;
      const hasEstimatedXg = Number(homeLiveXg) + Number(awayLiveXg) > 0;
      const evidence = [bsdLiveStats.available || statsResult.available || !!smMatch, hasShots, hasCorners, hasRealXg].filter(Boolean).length;
      const dataHealth = Math.round((evidence / 4) * 100);
      // A live estimate is allowed when it is driven by observed match events.
      // 50/50 is not a prediction; keep that unavailable until one side has evidence.
      if ((!hasShots && !hasCorners && !hasRealXg && !hasEstimatedXg) || (hp === 50 && ap === 50)) {
        return { available: false, market: null, selection: null, probability: null, dataHealth };
      }
      return {
        available: true,
        market: hasRealXg ? 'Goal proximity' : 'Estimated goal proximity',
        selection,
        probability,
        dataHealth,
        minute,
        source: xgSource,
        homeXg: Number(homeLiveXg),
        awayXg: Number(awayLiveXg),
        homeProximity: hp,
        awayProximity: ap
      };
    })(),
    valueAlert: { triggered: false },
    fromCache: { fixture: fromCacheFlag, stats: statsResult.fromCache },
  });
});

module.exports = router;
