const express = require('express');
const router = express.Router();
const cache = require('../utils/cache');
const config = require('../config/config');
const sportsDb = require('../services/sportsDbService');
const liveXg = require('../services/liveXgService');
const bsdService = require('../services/bsdService');

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
  const liveResult = await cache.getOrFetch('live:v2:all', config.cache.ttlLive, () =>
    sportsDb.getLiveScores()
  );

  if (liveResult.ok) {
    const rawLive = liveResult.data?.livescore || [];
    const simplified = rawLive
      .filter(e => String(e.strSport || '').toLowerCase() === 'soccer')
      .map(sportsDb.transformLiveEvent)
      .filter(m => sportsDb.isWhitelistedLeague(m.leagueId));
    return res.json({ matches: simplified, fromCache: liveResult.fromCache, source: 'livescore' });
  }

  // --- Fallback: eski yontem ---
  const today = new Date().toISOString().split('T')[0];
  const result = await cache.getOrFetch(`live:all:${today}`, config.cache.ttlLive, () =>
    sportsDb.getMatchesByDate(today)
  );

  if (!result.ok) {
    return res.status(502).json({ error: 'Canli veri alinamadi' });
  }

  const rawEvents = result.data?.events || [];
  const simplified = rawEvents
    .map(sportsDb.transformEvent)
    .filter(m => m.isLive && sportsDb.isWhitelistedLeague(m.leagueId));

  res.json({ matches: simplified, fromCache: result.fromCache, source: 'eventsday-fallback' });
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

  const liveResult = await cache.getOrFetch('live:v2:all', config.cache.ttlLive, () =>
    sportsDb.getLiveScores()
  );

  let match = null;
  let fromCacheFlag = false;

  if (liveResult.ok) {
    const rawLive = liveResult.data?.livescore || [];
    const rawMatch = rawLive.find(e => String(e.idEvent) === String(fixtureId));
    if (rawMatch) {
      match = sportsDb.transformLiveEvent(rawMatch);
      fromCacheFlag = liveResult.fromCache;
    }
  }

  if (!match) {
    const today = new Date().toISOString().split('T')[0];
    const result = await cache.getOrFetch(`live:all:${today}`, config.cache.ttlLive, () =>
      sportsDb.getMatchesByDate(today)
    );

    if (result.ok) {
      const rawEvents = result.data?.events || [];
      const raw = rawEvents.find(e => String(e.idEvent) === String(fixtureId));
      if (raw) {
        match = sportsDb.transformEvent(raw);
        fromCacheFlag = result.fromCache;
      }
    }
  }

  if (!match) {
    return res.status(404).json({ error: 'Mac bulunamadi' });
  }

  // --- Pro/Premium V2 ek veriler: zaman cizelgesi, istatistik, kadro, TV, highlights ---
  // Bitmis maclarda bu veri degismeyecegi icin uzun (6 saat) cache'leniyor;
  // canli maclarda kotayi korumak icin orta sureli (60 sn) cache'leniyor.
  // Kucuk liglerdeki maclarda bu veriler genelde bulunmuyor - o durumda
  // asagidaki *Result.available alanlari false donuyor, hicbir sey kirilmiyor.
  const isFinished = match.statusShort === 'FT';
  const extrasTtl = isFinished ? 60 * 60 * 6 : 60;

  const [timelineResult, statsResult, lineupResult, tvResult, highlightsResult] = await Promise.all([
    cache.getOrFetch(`tsdb-timeline:${fixtureId}`, extrasTtl, () => sportsDb.getEventTimelineFormatted(fixtureId)),
    cache.getOrFetch(`tsdb-stats:${fixtureId}`, extrasTtl, () => sportsDb.getEventStatsFormatted(fixtureId)),
    cache.getOrFetch(`tsdb-lineup:${fixtureId}`, extrasTtl, () => sportsDb.getEventLineupFormatted(fixtureId)),
    cache.getOrFetch(`tsdb-tv:${fixtureId}`, extrasTtl, () => sportsDb.getEventTVFormatted(fixtureId)),
    cache.getOrFetch(`tsdb-highlights:${fixtureId}`, extrasTtl, () => sportsDb.getEventHighlightsFormatted(fixtureId)),
  ]);

  const stats = statsResult.available ? statsResult.stats : {};

  // Canli xG/momentum/gol yakinligi hesabi icin iki takimin ham istatistiklerini
  // ortak sekle getiriyoruz. TheSportsDB "tehlikeli atak" ve "isabetsiz sut"
  // vermiyor, bu yuzden bu iki alan hep 0 - hesaplamalar geri kalan gercek
  // verilerle (isabetli sut, korner, varsa gercek xG) yapiliyor. Istatistik
  // henuz yoksa (mac yeni basladiysa) tum degerler 0 olur ve asagidaki
  // fonksiyonlar otomatik 50-50/0 donuyor - hicbir sey kirilmiyor.
  const homeRawStats = {
    shotsOnTarget: stats.shotsOnTarget ? (stats.shotsOnTarget.home ?? 0) : 0,
    shotsOffTarget: 0,
    corners: stats.corners ? (stats.corners.home ?? 0) : 0,
    dangerousAttacks: 0,
  };
  const awayRawStats = {
    shotsOnTarget: stats.shotsOnTarget ? (stats.shotsOnTarget.away ?? 0) : 0,
    shotsOffTarget: 0,
    corners: stats.corners ? (stats.corners.away ?? 0) : 0,
    dangerousAttacks: 0,
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

  if (stats.xg && stats.xg.home != null && stats.xg.away != null) {
    homeLiveXg = stats.xg.home;
    awayLiveXg = stats.xg.away;
    xgSource = 'thesportsdb';
  } else {
    const bsdXg = await bsdService.getRealXgForMatch(match.homeTeam, match.awayTeam, match.kickoff, isFinished);
    if (bsdXg.available && !bsdXg.estimated) {
      homeLiveXg = bsdXg.home;
      awayLiveXg = bsdXg.away;
      xgSource = 'bsd';
    } else {
      homeLiveXg = liveXg.estimateLiveXg(homeRawStats);
      awayLiveXg = liveXg.estimateLiveXg(awayRawStats);
      xgSource = 'estimate';
    }
  }

  // Momentum: genel baski (isabetli sut + korner agirlikli).
  // Gol yakinligi: hangi takim gole daha yakin (isabetli sut + korner + canli xG,
  // xG en agirlikli faktor) - kullanicinin canli ekranda gordugu "kim daha yakin" barı.
  const momentum = liveXg.calculateMomentum(homeRawStats, awayRawStats);
  const goalProximity = liveXg.calculateGoalProximity(homeRawStats, awayRawStats, homeLiveXg, awayLiveXg);

  res.json({
    fixtureId,
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
    possession: stats.possession ? { home: stats.possession.home ?? 50, away: stats.possession.away ?? 50 } : { home: 50, away: 50 },
    stats: {
      shotsOnTargetHome: homeRawStats.shotsOnTarget,
      shotsOnTargetAway: awayRawStats.shotsOnTarget,
      cornersHome: homeRawStats.corners,
      cornersAway: awayRawStats.corners,
      // TheSportsDB "tehlikeli atak" istatistigi vermiyor, gercek karsiligi yok.
      dangerousAttacksHome: 0,
      dangerousAttacksAway: 0,
      foulsHome: stats.fouls ? stats.fouls.home : null,
      foulsAway: stats.fouls ? stats.fouls.away : null,
      offsidesHome: stats.offsides ? stats.offsides.home : null,
      offsidesAway: stats.offsides ? stats.offsides.away : null,
      yellowCardsHome: stats.yellowCards ? stats.yellowCards.home : null,
      yellowCardsAway: stats.yellowCards ? stats.yellowCards.away : null,
      redCardsHome: stats.redCards ? stats.redCards.home : null,
      redCardsAway: stats.redCards ? stats.redCards.away : null,
    },
    statsAvailable: statsResult.available,
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
      const home = Number(goalProximity?.home ?? momentum?.home ?? 50);
      const away = Number(goalProximity?.away ?? momentum?.away ?? 50);
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
      const evidence = [statsResult.available, hasShots, hasCorners, hasRealXg].filter(Boolean).length;
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
