const config = require('../config/config');
const { fetchT } = require('../utils/fetchWithTimeout');

/**
 * Birden fazla API-Football kaynagi (RapidAPI ve/veya dogrudan
 * api-sports.io, farkli hesaplar dahil) tanimliysa, ilk kaynak kota
 * (429) hatasi verdiginde otomatik olarak siradaki kaynaga gecer.
 * Her kaynagin kendi base URL'i ve header yapisi olabilir (RapidAPI
 * ve api-sports.io farkli auth kullanir), bu yuzden URL path'i
 * (orn. '/fixtures') ayri parametre olarak aliniyor, tam URL kaynaga
 * gore burada olusturuluyor.
 *
 * @param {string} path - '/fixtures' gibi, baseUrl'den sonraki kisim
 * @param {(key: string) => object} buildParams - o istege ozel query
 *   parametrelerini dondurur (key kullanilmiyor ama imza tutarliligi icin birakildi)
 */
async function requestWithKeyFallback(path, buildParams, timeoutMs, label) {
  const sources = config.apiFootball.sources;

  if (sources.length === 0) {
    console.error(`[${label}] Hic API-Football anahtari tanimli degil (API_FOOTBALL_KEY veya API_FOOTBALL_DIRECT_KEY).`);
    return { ok: false, source: label, error: 'no_api_key' };
  }

  let lastResult = null;

  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    const options = {
      method: 'GET',
      url: `${src.baseUrl}${path}`,
      headers: src.headers(src.key),
      params: buildParams(),
    };
    const sourceLabel = sources.length > 1 ? `${label} (kaynak ${i + 1}/${sources.length}: ${src.type})` : label;
    const result = await fetchT(options, timeoutMs, sourceLabel);

    if (result.ok) {
      return result;
    }

    lastResult = result;

    const looksLikeQuotaIssue = result.error === 'http_429' || result.error === 'http_403';
    if (i < sources.length - 1 && looksLikeQuotaIssue) {
      console.warn(`[${label}] Kaynak ${i + 1} (${src.type}) kota/limit hatasi verdi, sonraki kaynaga geciliyor.`);
      continue;
    }
    if (!looksLikeQuotaIssue) break;
  }

  return lastResult;
}

/** Belirli bir gunun fikstur listesini ceker */
async function getFixturesByDate(dateStr) {
  return requestWithKeyFallback('/fixtures', () => ({ date: dateStr }), 6000, 'API-Football Fikstur');
}

/** Iki takim arasindaki gecmis karsilasmalar (H2H) */
async function getH2H(team1Id, team2Id) {
  return requestWithKeyFallback(
    '/fixtures/headtohead',
    () => ({ h2h: `${team1Id}-${team2Id}`, last: 10 }),
    6000,
    'API-Football H2H'
  );
}

/** Bir takimin son N maci (form) */
async function getTeamForm(teamId, last = 5) {
  return requestWithKeyFallback('/fixtures', () => ({ team: teamId, last }), 6000, 'API-Football Form');
}

/** Takim istatistikleri (sut, korner, kart ortalamalari icin ham veri) */
async function getTeamStatistics(teamId, leagueId, season) {
  return requestWithKeyFallback(
    '/teams/statistics',
    () => ({ team: teamId, league: leagueId, season }),
    6000,
    'API-Football Takim Istatistik'
  );
}

/** Tek bir fikstur icin temel bilgi: skor, dakika, takim adlari */
async function getFixtureById(fixtureId) {
  return requestWithKeyFallback('/fixtures', () => ({ id: fixtureId }), 5000, 'API-Football Fikstur Detay');
}

/** Su an canli oynanan maclar (dakika, skor, kart, korner) */
async function getLiveFixtures() {
  return requestWithKeyFallback('/fixtures', () => ({ live: 'all' }), 6000, 'API-Football Canli');
}

/** Tek bir mac icin canli detay (istatistik dahil) */
async function getLiveFixtureStats(fixtureId) {
  return requestWithKeyFallback(
    '/fixtures/statistics',
    () => ({ fixture: fixtureId }),
    5000,
    'API-Football Canli Istatistik'
  );
}

/** Bir lig icin puan durumu (siralama, aci farki, "description" alani icerir) */
async function getStandings(leagueId, season) {
  return requestWithKeyFallback('/standings', () => ({ league: leagueId, season }), 6000, 'API-Football Puan Durumu');
}

/** Bir mac icin sakatlik/ceza durumundaki oyuncular */
async function getInjuries(fixtureId) {
  return requestWithKeyFallback('/injuries', () => ({ fixture: fixtureId }), 5000, 'API-Football Sakatlik');
}

module.exports = {
  getFixturesByDate,
  getFixtureById,
  getH2H,
  getTeamForm,
  getTeamStatistics,
  getLiveFixtures,
  getLiveFixtureStats,
  getInjuries,
  getStandings,
};
