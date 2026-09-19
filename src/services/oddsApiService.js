const config = require('../config/config');
const { fetchT } = require('../utils/fetchWithTimeout');
const cache = require('../utils/cache');
const { teamNamesMatch, normalizeTeamName } = require('../utils/textNormalize');

/** Belirli bir lig icin coklu bookmaker oranlari */
async function getOddsForLeague(sportKey = 'soccer_epl') {
  return fetchT(
    {
      method: 'GET',
      url: `${config.oddsApi.baseUrl}/sports/${sportKey}/odds`,
      params: {
        apiKey: config.oddsApi.key,
        regions: 'eu',
        markets: 'h2h,totals',
        oddsFormat: 'decimal',
      },
    },
    6000,
    'The Odds API'
  );
}

/**
 * Bir ligin bugun/yakinda maci var mi diye ucretsiz (kota harcamayan)
 * events endpoint'i ile kontrol eder. The Odds API dokumantasyonuna gore
 * /events endpoint'i kota tuketmiyor - sadece /odds tuketiyor.
 * Bu sayede 35 ligin hepsini degil, sadece gercekten mac gunu olanlari
 * gercek (kotali) oran istegiyle tariyoruz.
 */
async function getEventsForLeague(sportKey) {
  if (!config.oddsApi.key) return { ok: false, error: 'no_odds_api_key' };
  return fetchT(
    {
      method: 'GET',
      url: `${config.oddsApi.baseUrl}/sports/${sportKey}/events`,
      params: { apiKey: config.oddsApi.key },
    },
    5000,
    `The Odds API Events (${sportKey})`
  );
}

async function getFixtureEventsByDate(dateStr) {
  if (!config.oddsApi.key) return { ok: false, error: 'no_odds_api_key', matches: [] };

  const keys = config.trackedLeagues || [];
  const settled = await Promise.all(keys.map(async (sportKey) => {
    const result = await getEventsForLeague(sportKey);
    if (!result.ok || !Array.isArray(result.data)) return [];
    return result.data
      .filter(event => String(event.commence_time || '').slice(0, 10) === dateStr)
      .map(event => ({
        fixtureId: `odds:${event.id}`,
        league: sportKey,
        leagueId: sportKey,
        kickoff: event.commence_time || null,
        statusShort: 'NS',
        minute: null,
        isLive: false,
        homeId: null,
        awayId: null,
        homeTeam: event.home_team || '',
        awayTeam: event.away_team || '',
        homeBadge: null,
        awayBadge: null,
        homeScore: 0,
        awayScore: 0,
        halftimeHome: null,
        halftimeAway: null,
        source: 'the-odds-api-events',
      }));
  }));

  const matches = settled.flat();
  const seen = new Set();
  return {
    ok: true,
    matches: matches.filter(match => {
      const key = [match.kickoff, normalizeTeamName(match.homeTeam), normalizeTeamName(match.awayTeam)].join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  };
}

async function hasMatchesToday(sportKey, windowHours = 30) {
  const result = await getEventsForLeague(sportKey);

  if (!result.ok || !Array.isArray(result.data)) return false;

  const now = Date.now();
  const windowMs = windowHours * 60 * 60 * 1000;

  return result.data.some(event => {
    const kickoff = new Date(event.commence_time).getTime();
    return kickoff - now < windowMs && kickoff - now > -3 * 60 * 60 * 1000; // gecmis 3 saat - ileri windowHours
  });
}

/**
 * Oran hareketi grafigi icin zaman ici anlik goruntu kaydeder.
 * Once ucretsiz events endpoint'i ile o ligde gercekten mac olup
 * olmadigi kontrol edilir - mac yoksa kotali /odds istegi hic yapilmaz.
 * The Odds API'nin ucretsiz plani gecmis oran vermiyor, bu yuzden
 * kendimiz periyodik olarak (cron ile) bu fonksiyonu cagirip
 * cache'e biriktiriyoruz. Sunucu yeniden baslarsa gecmis silinir -
 * kalici saklamak icin ileride bir DB'ye tasinmali.
 */
async function recordOddsSnapshot(sportKey) {
  const hasMatches = await hasMatchesToday(sportKey);
  if (!hasMatches) {
    console.log(`[odds-snapshot] ${sportKey} - bugun mac yok, atlaniyor (kota korunuyor)`);
    return;
  }

  const result = await getOddsForLeague(sportKey);
  if (!result.ok) return;

  const historyKey = `oddsHistory:${sportKey}`;
  const existing = cache.get(historyKey) || [];

  const snapshot = {
    timestamp: new Date().toISOString(),
    matches: (result.data || []).map(m => ({
      id: m.id,
      homeTeam: m.home_team,
      awayTeam: m.away_team,
      // ilk bookmaker'in h2h oranini ornek olarak aliyoruz
      odds: m.bookmakers?.[0]?.markets?.find(mk => mk.key === 'h2h')?.outcomes || [],
    })),
  };

  existing.push(snapshot);
  // son 48 kayit tutulur (30 dk araliklarla yaklasik 24 saat)
  const trimmed = existing.slice(-48);
  cache.set(historyKey, trimmed, 60 * 60 * 30); // 30 saat TTL
}

/** Bir lig icin biriken oran gecmisini dondurur */
function getOddsHistory(sportKey) {
  return cache.get(`oddsHistory:${sportKey}`) || [];
}

/**
 * Kelly Criterion stake hesaplama
 * @param {number} modelProbability - modelin verdigi olasilik (0-1 arasi)
 * @param {number} decimalOdds - bahis sirketinin ondalik orani
 * @param {number} bankrollFraction - maksimum ne kadarlik dilim riske girsin (varsayilan tam Kelly'nin %25'i - guvenli)
 */
function calculateKellyStake(modelProbability, decimalOdds, bankrollFraction = 0.25) {
  const b = decimalOdds - 1; // net kazanc orani
  const q = 1 - modelProbability;
  const fullKelly = (b * modelProbability - q) / b;
  const safeKelly = Math.max(0, fullKelly * bankrollFraction);
  return {
    fullKellyPercent: +(fullKelly * 100).toFixed(2),
    recommendedStakePercent: +(safeKelly * 100).toFixed(2),
    hasValue: fullKelly > 0,
  };
}

/** Modelin tahmini ile piyasa orani arasindaki value farkini bulur */
function findValueBets(modelProbabilities, marketOdds) {
  // modelProbabilities: { home: 0.6, draw: 0.23, away: 0.17 }
  // marketOdds: { home: 1.75, draw: 3.8, away: 5.2 }
  const results = {};
  for (const outcome of Object.keys(modelProbabilities)) {
    const impliedProb = 1 / marketOdds[outcome];
    const edge = modelProbabilities[outcome] - impliedProb;
    results[outcome] = {
      modelProbability: modelProbabilities[outcome],
      impliedProbability: +impliedProb.toFixed(3),
      edge: +edge.toFixed(3),
      isValueBet: edge > 0.03, // %3 uzeri fark anlamli value kabul edilir
      kelly: calculateKellyStake(modelProbabilities[outcome], marketOdds[outcome]),
    };
  }
  return results;
}

/** Bir ligin oran yanitindan belirli bir mac icin 1X2 oranini bulur */
function extractMatchOdds(oddsResponse, homeTeamName, awayTeamName) {
  if (!Array.isArray(oddsResponse)) return null;

  // Exact-match yerine normalize edilmis karsilastirma kullaniyoruz -
  // Isvec/Norvec/Finlandiya/Isvicre gibi ulkelerde aksanli/aksansiz
  // yazim farklari yuzunden exact-match veri kacirabiliyordu.
  const match = oddsResponse.find(m =>
    teamNamesMatch(m.home_team, homeTeamName) && teamNamesMatch(m.away_team, awayTeamName)
  );
  if (!match || !match.bookmakers?.length) return null;

  const h2hMarket = match.bookmakers[0].markets?.find(mk => mk.key === 'h2h');
  if (!h2hMarket) return null;

  // Oran satirlarini da normalize edilmis isimle bulmamiz gerekiyor,
  // cunku bu satirlardaki isim de API-Football'dan gelen isimle
  // birebir ayni olmayabilir.
  const findOdd = (targetName) =>
    h2hMarket.outcomes.find(o => teamNamesMatch(o.name, targetName))?.price;

  const odds = {
    home: findOdd(homeTeamName),
    draw: h2hMarket.outcomes.find(o => normalizeTeamName(o.name) === 'draw')?.price,
    away: findOdd(awayTeamName),
  };

  if (!odds.home || !odds.draw || !odds.away) return null;
  return odds;
}

/**
 * Ondalik oranlari, bookmaker marjini (overround) cikarilmis gercek
 * olasiliklara cevirir. Oranlarin ham 1/oran toplami her zaman %100'u
 * gecer (bu fark bookmaker'in kar marjidir) - normalize ederek
 * gercek "piyasanin dusundugu" olasiligi elde ediyoruz.
 */
function normalizeImpliedProbabilities(decimalOdds) {
  if (!decimalOdds) return null;

  const impliedHome = 1 / decimalOdds.home;
  const impliedDraw = 1 / decimalOdds.draw;
  const impliedAway = 1 / decimalOdds.away;
  const overround = impliedHome + impliedDraw + impliedAway;

  return {
    home: +((impliedHome / overround) * 100).toFixed(1),
    draw: +((impliedDraw / overround) * 100).toFixed(1),
    away: +((impliedAway / overround) * 100).toFixed(1),
    overroundPercent: +((overround - 1) * 100).toFixed(1),
  };
}

/**
 * Model tahminini piyasa (bookmaker) olasiligiyla harmanlar. Piyasa
 * oranlari halkin ve profesyonellerin toplu bilgisini zaten icerdigi
 * icin, tek basina herhangi bir modelden genelde daha iyi kalibre
 * olur - kendi modelimizle harmanlamak genelde ikisinden de iyi sonuc verir.
 * @param {object} modelProbs - calculateMatchProbabilities(...) ciktisi
 * @param {object} marketProbs - normalizeImpliedProbabilities(...) ciktisi
 * @param {number} modelWeight - 0-1 arasi, modelin agirligi (varsayilan %50)
 */
function blendWithMarket(modelProbs, marketProbs, modelWeight = 0.5) {
  if (!marketProbs) {
    return { ...modelProbs, blended: false };
  }

  const marketWeight = 1 - modelWeight;
  const blendedHome = modelProbs.homeWinProbability * modelWeight + marketProbs.home * marketWeight;
  const blendedDraw = modelProbs.drawProbability * modelWeight + marketProbs.draw * marketWeight;
  const blendedAway = modelProbs.awayWinProbability * modelWeight + marketProbs.away * marketWeight;
  const total = blendedHome + blendedDraw + blendedAway || 1;

  return {
    homeWinProbability: +((blendedHome / total) * 100).toFixed(1),
    drawProbability: +((blendedDraw / total) * 100).toFixed(1),
    awayWinProbability: +((blendedAway / total) * 100).toFixed(1),
    blended: true,
    modelWeight,
    marketWeight,
  };
}

module.exports = {
  getOddsForLeague,
  getEventsForLeague,
  getFixtureEventsByDate,
  hasMatchesToday,
  recordOddsSnapshot,
  getOddsHistory,
  calculateKellyStake,
  findValueBets,
  extractMatchOdds,
  normalizeImpliedProbabilities,
  blendWithMarket,
};
