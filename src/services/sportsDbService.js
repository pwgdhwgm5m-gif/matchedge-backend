/**
 * sportsDbService.js
 * SoccerEdge Pro — TheSportsDB (Premium) veri kaynağı.
 * free-api-live-football-data aylık kotasını doldurdugu icin
 * /api/matches ve diger liglerin form verisi bu kaynaga tasindi.
 */

const { normalizeTeamName } = require('../utils/textNormalize');
const cache = require('../utils/cache');
const config = require('../config/config');

const BASE_URL = 'https://www.thesportsdb.com/api/v1/json';
const V2_BASE_URL = 'https://www.thesportsdb.com/api/v2/json';
const API_KEY = process.env.SPORTSDB_API_KEY || process.env.THESPORTSDB_KEY || config.sportsDb.key || '3';

// TheSportsDB'nin gercekten kullandigi durum kodlari (V2 canli skor ornek
// verisinden dogrulandi). "Match Finished" gibi baska API'lerden (orn.
// API-Football) kalma, TheSportsDB'de hic gorunmeyen degerler de guvenlik
// icin listede tutuluyor.
const FINISHED_STATUSES = new Set(['FT', 'AET', 'PEN', 'FT_PEN', 'Match Finished', 'AWARDED', 'WO', 'ABD', 'CANC', 'POSTP']);
const LIVE_STATUSES = new Set(['1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE']);

// free-api-live-football-data (FotMob) semasindaki leagueId -> TheSportsDB idLeague.
const LEAGUE_ID_MAP = {
  '47': 4328,   // Premier League
  '87': 4335,   // La Liga
  '55': 4332,   // Serie A
  '54': 4331,   // Bundesliga
  '53': 4334,   // Ligue 1
  '57': 4337,   // Eredivisie
  '135': 4336,  // Yunanistan Super League
  '59': 4358,   // Norvec Eliteserien
  '67': 4347,   // Isvec Allsvenskan
  '196': 4422,  // Polonya Ekstraklasa
  '63': 4355,   // Rusya Premier Lig
  '61': 4344,   // Portekiz Liga Portugal
  '51': 4636,   // Finlandiya Veikkausliiga
  '40': 4338,   // Belcika First Division A
  '46': 4340,   // Danimarka Superligaen
  '64': 4330,   // Iskocya Premiership
  '252': 4629,  // Hirvatistan HNL
  '189': 4691,  // Romanya Liga I
  '4510': 4510, // Portekiz Kupasi
  '71': 4339,   // Turkiye Super Lig
};

/**
 * Sadece buyuk liglerin/kupalarin gosterilmesi icin TheSportsDB idLeague
 * beyaz listesi. Eskiden /api/matches, /api/results, /api/live gunun TUM
 * maclarini (kucuk alt ligler, amator kupa turlari, bilinmeyen bolgesel
 * ligler dahil - bazi gunler 90+ mac) donduruyordu, bu da uygulamayi
 * kullanilamaz derecede karisik hale getiriyordu. Artik bu liste disinda
 * kalan hicbir mac API yanitlarinda gorunmuyor.
 */
const WHITELISTED_LEAGUE_IDS = new Set([
  // --- Avrupa 1. Ligleri ---
  '4328', // Ingiltere Premier League
  '4335', // Ispanya La Liga
  '4332', // Italya Serie A
  '4331', // Almanya Bundesliga
  '4334', // Fransa Ligue 1
  '4337', // Hollanda Eredivisie
  '4641', // Hollanda Eerste Divisie (BSD yoksa doğrulanmış yedek)
  '4344', // Portekiz Primeira Liga
  '4330', // Iskocya Premiership
  '4336', // Yunanistan Super League
  '4355', // Rusya Premier League
  '4422', // Polonya Ekstraklasa
  '4338', // Belcika First Division A
  '4340', // Danimarka Superligaen
  '4358', // Norvec Eliteserien
  '4347', // Isvec Allsvenskan
  '4636', // Finlandiya Veikkausliiga
  '4339', // Turkiye Super Lig
  '4621', // Avusturya Bundesliga
  '4675', // Isvicre Super League
  '4629', // Hirvatistan HNL
  '4691', // Romanya Liga I
  '4631', // Czech First League
  '4671', // Serbian Super Liga
  '4354', // Ukrainian Premier League
  '4690', // Hungarian NB I
  '4643', // League of Ireland Premier Division
  '4359', // Chinese Super League
  // --- Amerika 1. Ligleri ---
  '4346', // ABD MLS
  '4350', // Meksika Liga MX
  '4351', // Brezilya Serie A
  '4406', // Arjantin Primera Division
  // --- Asya 1. Ligleri ---
  '4633', // Japonya J1 League
  '4689', // Guney Kore K League 1
  // --- Buyuk Kupalar / Turnuvalar ---
  '4480', // UEFA Sampiyonlar Ligi
  '4481', // UEFA Avrupa Ligi
  '4482', // Ingiltere FA Cup
  '4483', // Ispanya Copa del Rey
  '4484', // Fransa Coupe de France
  '4485', // Almanya DFB-Pokal
  '4506', // Italya Coppa Italia
  '4501', // Copa Libertadores
  '4490', // UEFA Uluslar Ligi
  '5071', // UEFA Konferans Ligi
  '4503', // FIFA Kulupler Dunya Kupasi
  '4570', // Ingiltere Ligi Kupasi (Carabao Cup / EFL Cup)
  '4510', // Portekiz Kupasi
  '4902', // Hollanda KNVB Beker / Dutch KNVB Cup
  '4960', // Turkiye Kupasi (TheSportsDB current competition id)
  '4903', // Almanya Super Cup
  '5831', // Belgian Cup
  '5830', // Greek Football Cup
  '4723', // Scottish FA Cup
  '5489', // Swiss Cup
  '5883', // Austrian Cup
  '5634', // Norwegian Cupen
  '4756', // Svenska Cupen
  '5838', // Puchar Polski
  '5193', // Russia Cup
  '5199', // US Open Cup
  '5637', // Japan Emperor's Cup
  '5635', // Korea Cup
  '5525', // China FA Cup
  '5180', // Australia Cup
]);

function isWhitelistedLeague(leagueId) {
  return WHITELISTED_LEAGUE_IDS.has(String(leagueId));
}

// Guard against provider rows whose competition id and displayed league name
// disagree. A mismatched row must never be relabelled as a trusted competition.
const STRICT_LEAGUE_NAMES = {
  '4641': ['dutch eerste divisie','eerste divisie','keuken kampioen divisie'],
  '4482': ['fa cup','english fa cup','the fa cup'],
  '4483': ['copa del rey'],
  '4484': ['coupe de france'],
  '4485': ['dfb-pokal','dfb pokal'],
  '4506': ['coppa italia'],
  '4510': ['taça de portugal','taca de portugal','portuguese cup'],
  '4960': ['turkish cup','türkiye kupası','turkiye kupasi'],
  '4631': ['czech first league'],
  '4671': ['serbian super liga','serbian superliga','serbian super league'],
  '4354': ['ukrainian premier league'],
  '4690': ['hungarian nb i','nemzeti bajnokság i','nemzeti bajnoksag i'],
  '4643': ['league of ireland premier division','irish premier division'],
  '4359': ['chinese super league'],
  '5831': ['belgian cup','croky cup'],
  '5830': ['greek cup','greek football cup'],
  '4723': ['scottish fa cup','scottish cup'],
  '5489': ['swiss cup','schweizer cup'],
  '5883': ['austrian cup','öfb cup','ofb cup'],
  '5634': ['norwegian cup','norway cup','norwegian cupen'],
  '4756': ['svenska cupen','swedish cup'],
  '5838': ['puchar polski','polish cup'],
  '5193': ['russian cup','russia cup','russian football cup'],
  '5199': ['us open cup','u.s. open cup'],
  '5637': ['emperor cup',"emperor's cup",'emperors cup',"japan emperor's cup",'japan emperors cup'],
  '5635': ['korea cup','korean fa cup'],
  '5525': ['china fa cup','chinese fa cup'],
  '5180': ['australia cup','australia ffa cup','ffa cup']
};
function isLeagueIdentityConsistent(leagueId, leagueName) {
  const expected = STRICT_LEAGUE_NAMES[String(leagueId)];
  if (!expected) return true;
  const actual = String(leagueName || '').trim().toLowerCase();
  return expected.some(name => actual === name || actual.includes(name));
}

async function fetchT(url, timeoutMs) {
  const ms = timeoutMs || 10000;
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      return { ok: false, error: 'http_' + res.status };
    }
    const json = await res.json();
    return { ok: true, data: json };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Belirli bir gunun tum futbol maclarini ceker.
 * @param {string} dateStr - 'YYYY-MM-DD'
 */
async function getMatchesByDate(dateStr) {
  const url = BASE_URL + '/' + API_KEY + '/eventsday.php?d=' + dateStr + '&s=Soccer';
  return fetchT(url, 10000);
}

async function getEventById(eventId) {
  if (!eventId) return { ok:false, error:'missing_event_id' };
  const url = BASE_URL + '/' + API_KEY + '/lookupevent.php?id=' + encodeURIComponent(String(eventId));
  return fetchT(url, 10000);
}

/**
 * TheSportsDB'nin ham event nesnesini, eski freeFootballApiService ile
 * ayni sekle cevirir - route/frontend hicbir sey degistirmeden calisir.
 *
 * ONEMLI DUZELTME: Eskiden "bitti mi" kontrolu sadece strStatus alanina
 * bakiyordu (== 'FT'). eventsday.php gecmis tarihli maclarda bu alani
 * her zaman guvenilir doldurmuyor (bos/farkli deger donebiliyor) - bu
 * yuzden dun oynanmis, sonuclanmis bir mac hala "CANLI" gorunebiliyordu.
 * Simdi tarih de kontrol ediliyor: mac tarihi bugunden onceyse, statusShort
 * ne olursa olsun kesin olarak "bitti" kabul ediliyor. "Canli" ise artik
 * SADECE gercekten bilinen canli periyot kodlarindan biriyse (1H/HT/2H/ET
 * vb.) true donuyor - eskiden "NS degilse ve skor varsa canli say" gibi
 * cok gevsek bir kural vardi, bu yanlis pozitiflere yol aciyordu.
 */
/**
 * TheSportsDB zaman damgalari ("strTimestamp", dateEvent+strTime) UTC
 * olarak geliyor ama sonunda 'Z' YOK. Bu haliyle frontend'e gonderilince
 * tarayici bunu YEREL saat saniyor (JS spesifikasyonu geregi 'Z'siz
 * tarih-saat string'leri local olarak parse edilir) ve hicbir donusum
 * yapmadan oldugu gibi gosteriyor - Turkiye (UTC+3) icin gercek saatten
 * 3 saat erken gorunmesine yol aciyordu (orn. gercek 22:30 yerine 19:30).
 * 'Z' eklenince tarayici doğru sekilde UTC'den yerel saate ceviriyor.
 */
function toUtcIso(raw) {
  if (!raw) return null;
  return /Z$/i.test(raw) ? raw : raw + 'Z';
}

/**
 * TESPIT EDILEN HATA: TheSportsDB'nin canli skor beslemesi bazen bir maci
 * "canli" durumda (orn. 2H, 65') DONDURUP birakiyor - mac gercekte cok daha
 * once bitmis (hatta baska bir kaynaktan - BSD'den - dogrulandi: ayni mac
 * gercekte 92. dakika 7-2 iken bizim tarafta hala 65. dakika 4-2 gorunuyordu)
 * ama TheSportsDB hicbir zaman "FT"ye cevirmiyor, biz de kaynaga guvendigimiz
 * icin sonsuza kadar "CANLI 65'" gostermeye devam ediyorduk.
 *
 * Cozum: kickoff saatinden bu yana GERCEKTEN gecen sureyi kontrol ediyoruz.
 * Normal sureli (uzatmasiz) bir maç makul biçimde ~120 dakikada (90 dk +
 * araya giren duraklamalar) biter; bu yuzden 1H/2H/HT durumundaki bir mac
 * kickoff'tan 130 dakikadan fazla sure gecmisse artik "donmus" kabul edilip
 * bitmis sayiliyor. Uzatma/penalti olasi cup maclari icin daha genis bir
 * MUTLAK sinir (170 dakika) var - hangi periyot kodu olursa olsun bu sureyi
 * gecen hicbir mac gercekci degildir.
 */
const LIVE_STALE_NORMAL_MS = 130 * 60 * 1000;
const LIVE_STALE_ABSOLUTE_MS = 170 * 60 * 1000;
const NORMAL_TIME_LIVE_STATUSES = new Set(['1H', '2H', 'HT']);

function isStaleLiveStatus(kickoffIso, statusUpper) {
  if (!kickoffIso) return false;
  const kickoffMs = new Date(kickoffIso).getTime();
  if (isNaN(kickoffMs)) return false;
  const elapsedMs = Date.now() - kickoffMs;
  if (elapsedMs > LIVE_STALE_ABSOLUTE_MS) return true;
  if (elapsedMs > LIVE_STALE_NORMAL_MS && NORMAL_TIME_LIVE_STATUSES.has(statusUpper)) return true;
  return false;
}

function transformEvent(e) {
  const status = String(e.strStatus || '').trim();
  const statusUpper = status.toUpperCase();
  const eventDateStr = String(e.dateEvent || (e.strTimestamp || '').slice(0, 10) || '');
  const todayStr = new Date().toISOString().slice(0, 10);
  const isPastDate = eventDateStr && eventDateStr < todayStr;

  // TheSportsDB'nin gunluk mac listesi (eventsday.php) bazi maclarda skoru
  // doldurmasina ragmen strStatus alanini bos/eksik birakabiliyor (ozellikle
  // gecmis tarihli, daha az takip edilen liglerde) - bu yuzden bitmis,
  // skoru belli bir mac yanlislikla "Baslamadi" gorunebiliyordu. Artik: her
  // iki takimin da skoru doluysa VE mac su an canli degilse, statusShort/
  // tarih ne derse desin kesin olarak "bitti" sayiyoruz.
  const hasScore = e.intHomeScore !== null && e.intHomeScore !== undefined &&
                    e.intAwayScore !== null && e.intAwayScore !== undefined;

  const kickoffIso = toUtcIso(e.strTimestamp || (e.dateEvent + 'T' + (e.strTime || '00:00:00')));
  const liveByStatus = !isPastDate && LIVE_STATUSES.has(statusUpper);
  // Kickoff'tan bu yana gercekci olmayan bir sure gecmisse (bkz. yukarida
  // isStaleLiveStatus) donmus canli veriye guvenmek yerine bitmis sayiyoruz.
  const isLive = liveByStatus && !isStaleLiveStatus(kickoffIso, statusUpper);
  const finished = !isLive && (FINISHED_STATUSES.has(status) || isPastDate || hasScore || liveByStatus);

  return {
    fixtureId: e.idEvent,
    league: e.strLeague || '',
    leagueId: e.idLeague,
    kickoff: kickoffIso,
    statusShort: finished ? 'FT' : (status || 'NS'),
    minute: e.strProgress ? parseInt(e.strProgress, 10) : null,
    isLive: isLive,
    homeTeam: e.strHomeTeam || '',
    awayTeam: e.strAwayTeam || '',
    homeId: e.idHomeTeam || null,
    awayId: e.idAwayTeam || null,
    homeBadge: e.strHomeTeamBadge || null,
    awayBadge: e.strAwayTeamBadge || null,
    homeScore: e.intHomeScore !== null && e.intHomeScore !== undefined && e.intHomeScore !== '' ? parseInt(e.intHomeScore, 10) : null,
    awayScore: e.intAwayScore !== null && e.intAwayScore !== undefined && e.intAwayScore !== '' ? parseInt(e.intAwayScore, 10) : null,
    // NOT: TheSportsDB'nin gunluk/gecmis mac listesi endpoint'leri
    // (eventsday.php, eventspastleague.php) ilk yari skorunu hic saglamiyor -
    // sadece mac sonu skoru var. Bu alan bu yuzden hep null; frontend zaten
    // sadece doluyken gosteriyor, dolayisiyla bir sey kirilmiyor, sadece
    // ilk yari skoru bu ekranda hicbir zaman gorunmeyecek (veri kaynagi sinirlamasi).
    halftimeHome: parseOptionalScore(e.intHomeScoreHalfTime ?? e.intHomeScoreHT),
    halftimeAway: parseOptionalScore(e.intAwayScoreHalfTime ?? e.intAwayScoreHT),
  };
}

function parseOptionalScore(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * eventsday.php (gunun tum fikstur listesi - /api/matches ve /api/results
 * BUNU kullanir) canli bir macin skorunu GUNCEL VERMIYOR - sadece periyodik
 * yenilenen bir gunluk liste, dakika/skor degisikligini gec yansitiyor (bazen
 * hic yansitmiyor). Gercek zamanli skor SADECE V2 livescore endpoint'inden
 * geliyor (getLiveScores - /api/live rotasi zaten bunu kullaniyor).
 *
 * Bu yuzden: eventsday.php'den gelen mac listesi olusturulduktan sonra, ayni
 * anda cekilen livescore listesiyle "bindirme" yapiliyor - fixtureId eslesen
 * her mac icin skor/dakika/durum, canli kaynaktan gelen GUNCEL degerlerle
 * degistiriliyor. Boylece ana sayfa ve sonuclar ekrani da, canli simulator
 * ekraniyla AYNI kaynaktan (livescore) guncel skoru gosteriyor - once sadece
 * mac detayina girince guncel skor gorunuyordu, listede eski skor kalıyordu.
 *
 * @param {Array} matches - transformEvent ciktisi mac listesi
 * @param {Array} liveEvents - getLiveScores() ham "livescore" dizisi (soccer filtreli)
 */
function applyLiveOverlay(matches, liveEvents) {
  if (!liveEvents || !liveEvents.length) return matches;
  const liveMap = new Map();
  liveEvents.forEach(function (e) { liveMap.set(String(e.idEvent), e); });

  return matches.map(function (m) {
    const raw = liveMap.get(String(m.fixtureId));
    if (!raw) return m;

    const rawStatus = String(raw.strStatus || '').trim();
    const statusUpper = rawStatus.toUpperCase();
    const liveByStatus = LIVE_STATUSES.has(statusUpper);
    // Ayni "donmus canli veri" korumasi burada da gerekli - livescore
    // kaynagi bazen bir maci gercekte bittikten sonra da uzun sure "2H"
    // gibi bir durumda birakabiliyor (bkz. isStaleLiveStatus yorumu).
    const stale = liveByStatus && isStaleLiveStatus(m.kickoff, statusUpper);
    const isLiveNow = liveByStatus && !stale;
    const isFinishedNow = FINISHED_STATUSES.has(rawStatus) || stale;

    return Object.assign({}, m, {
      homeScore: raw.intHomeScore !== null && raw.intHomeScore !== undefined ? parseInt(raw.intHomeScore, 10) : m.homeScore,
      awayScore: raw.intAwayScore !== null && raw.intAwayScore !== undefined ? parseInt(raw.intAwayScore, 10) : m.awayScore,
      minute: raw.strProgress ? parseInt(raw.strProgress, 10) : m.minute,
      statusShort: isFinishedNow ? 'FT' : (statusUpper || m.statusShort),
      isLive: isLiveNow,
    });
  });
}

/**
 * V2 API icin header-tabanli istek (X-API-KEY). V1'den farkli olarak key
 * URL'de degil header'da gonderiliyor.
 */
async function fetchV2(path, timeoutMs) {
  const ms = timeoutMs || 8000;
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, ms);
  try {
    const res = await fetch(V2_BASE_URL + path, {
      signal: controller.signal,
      headers: { 'X-API-KEY': API_KEY },
    });
    if (!res.ok) {
      return { ok: false, error: 'http_' + res.status };
    }
    const json = await res.json();
    return { ok: true, data: json };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * TheSportsDB'nin GERCEK canli skor endpoint'i (V2, sadece premium).
 * eventsday.php'nin aksine gercek dakika (strProgress) ve gercek periyot
 * kodu (1H/HT/2H) doner - bu yuzden "kacinci dakikada" bilgisi ancak
 * buradan gelebiliyor.
 */
async function getLiveScores() {
  return fetchV2('/livescore/soccer', 8000);
}

/** V2 canli skor event'ini frontend'in bekledigi sekle cevirir */
function transformLiveEvent(e) {
  const status = String(e.strStatus || '').trim().toUpperCase();
  const kickoffIso = e.dateEvent && e.strEventTime ? toUtcIso(e.dateEvent + 'T' + e.strEventTime) : null;
  const stale = isStaleLiveStatus(kickoffIso, status);
  const finished = FINISHED_STATUSES.has(status) || status === 'FT';
  const isLive = !finished && !stale && (LIVE_STATUSES.has(status) || !status);
  return {
    fixtureId: e.idEvent,
    league: e.strLeague || '',
    leagueId: e.idLeague,
    kickoff: kickoffIso,
    statusShort: finished || stale ? 'FT' : (status || 'LIVE'),
    minute: e.strProgress ? parseInt(e.strProgress, 10) : null,
    isLive: isLive,
    homeTeam: e.strHomeTeam || '',
    awayTeam: e.strAwayTeam || '',
    homeBadge: e.strHomeTeamBadge || null,
    awayBadge: e.strAwayTeamBadge || null,
    homeScore: e.intHomeScore !== null && e.intHomeScore !== undefined && e.intHomeScore !== '' ? parseInt(e.intHomeScore, 10) : null,
    awayScore: e.intAwayScore !== null && e.intAwayScore !== undefined && e.intAwayScore !== '' ? parseInt(e.intAwayScore, 10) : null,
    halftimeHome: null,
    halftimeAway: null,
  };
}

/**
 * Bir ligin gecmis maclarini ceker (premium key ile yuksek limit).
 * @param {number} tsdbLeagueId - TheSportsDB idLeague
 */
async function getLeaguePastEvents(tsdbLeagueId) {
  const url = BASE_URL + '/' + API_KEY + '/eventspastleague.php?id=' + tsdbLeagueId;
  return fetchT(url, 10000);
}

/** Ham TheSportsDB event nesnesini analysisEngine'in bekledigi sekle cevirir */
function toAnalysisFixture(e) {
  return {
    fixture: { id: e.idEvent, date: e.strTimestamp || e.dateEvent },
    teams: {
      home: { id: e.idHomeTeam, name: e.strHomeTeam },
      away: { id: e.idAwayTeam, name: e.strAwayTeam },
    },
    goals: {
      home: e.intHomeScore !== null && e.intHomeScore !== undefined ? parseInt(e.intHomeScore, 10) : null,
      away: e.intAwayScore !== null && e.intAwayScore !== undefined ? parseInt(e.intAwayScore, 10) : null,
    },
    score: { halftime: { home: null, away: null } },
  };
}

/**
 * Takim adindan TheSportsDB takim ID'sini bulur (searchteams.php).
 * ID'ler degismedigi icin 30 gun cache'leniyor - premium kotasini
 * (20 istek/dk) bosa harcamamak icin onemli.
 */
function isNationalTeamRecord(team) {
  const league = String(team?.strLeague || '').toLowerCase();
  const type = String(team?.strTeamType || team?.strSport || '').toLowerCase();
  const country = String(team?.strCountry || '').toLowerCase();
  return /national|international/.test(type) ||
    /uefa nations|world cup|euro qualification|international/.test(league) ||
    country === 'worldwide';
}

async function resolveTeamId(teamName, options) {
  options = options || {};
  // v3 intentionally invalidates the old 30-day cache whose permissive
  // teams[0] fallback could bind a country name to a similarly named club.
  const cacheKey = `tsdb-teamid:v3:${options.international ? 'national:' : 'club:'}${normalizeTeamName(teamName)}`;
  const result = await cache.getOrFetch(cacheKey, 60 * 60 * 24 * 30, async () => {
    const url = BASE_URL + '/' + API_KEY + '/searchteams.php?t=' + encodeURIComponent(teamName);
    const res = await fetchT(url, 8000);
    if (!res.ok) return { ok: false };
    const teams = (res.data && res.data.teams) || [];
    if (!teams.length) return { ok: false };
    const normalized = normalizeTeamName(teamName);
    const exact = teams.filter(function (t) { return normalizeTeamName(t.strTeam) === normalized; });
    if (!exact.length) return { ok: false, error: 'team_identity_not_exact' };
    const candidates = options.international ? exact.filter(isNationalTeamRecord) : exact;
    if (!candidates.length) return { ok: false, error: 'team_identity_type_mismatch' };
    // Ambiguous exact names are unsafe without provider identity metadata.
    const ids = [...new Set(candidates.map(t => String(t.idTeam || '')).filter(Boolean))];
    if (ids.length !== 1) return { ok: false, error: 'team_identity_ambiguous' };
    return { ok: true, idTeam: ids[0] };
  });
  return result.ok ? result.idTeam : null;
}

/**
 * Bir takimin son maclarini TAKIMA OZEL endpoint'ten ceker (premium: son
 * 10 mac, hem ev hem deplasman dahil). eventspastleague.php'nin aksine
 * (asagida, fallback olarak kalan eski yontem) bu, ligin dar bir "son
 * birkac mac" penceresine sikismiyor - o pencerede o takimin maci
 * olmasa bile (orn. lig lideri Barcelona gibi, arada UEFA/kupa maclari
 * araya girince ligdeki son maci pencerenin disinda kalabiliyordu)
 * dogru sonuc doner.
 */
async function getTeamLastEvents(teamId) {
  const url = BASE_URL + '/' + API_KEY + '/eventslast.php?id=' + teamId;
  return fetchT(url, 8000);
}

/**
 * analysisEngine.js'in beklendigi {ok, data:{response:[...]}, teamId} formatinda
 * bir takimin son N macini doner. Once takima ozel eventslast.php denenir
 * (daha guvenilir); o basarisiz/bos donerse eski yontem (ligin son
 * olaylarindan isimle filtreleme) fallback olarak calisir.
 * @param {string} teamName
 * @param {number|string} fotmobLeagueId
 */
async function getTeamFixturesForAnalysis(teamName, fotmobLeagueId, count, tsdbLeagueIdOverride, options) {
  const n = count || 15;

  let teamId = await resolveTeamId(teamName, options);
  // A fixture supplied by TheSportsDB can disambiguate names that searchteams
  // does not resolve. Never trust a caller-supplied team ID without this lookup.
  if (!teamId && options?.fixtureId && options?.fixtureSide) {
    const fixture = await getEventById(options.fixtureId).catch(() => ({ ok: false }));
    const event = fixture.data?.events?.find(e => String(e.idEvent) === String(options.fixtureId));
    const side = options.fixtureSide === 'home' ? 'Home' : 'Away';
    if (event && normalizeTeamName(event['str' + side + 'Team']) === normalizeTeamName(teamName)) {
      teamId = event['id' + side + 'Team'] || null;
    }
  }
  if (teamId) {
    const schedule = await getTeamSeasonSchedule(teamId).catch(() => ({ ok: false }));
    const scheduleEvents = Array.isArray(schedule.data) ? schedule.data :
      (schedule.data?.schedule || schedule.data?.events || []);
    const cutoff = Date.parse(options?.kickoff || '') || Date.now();
    const complete = e => {
      const time = Date.parse(e.strTimestamp || e.dateEvent || '');
      return String(e.idHomeTeam || '') === String(teamId) || String(e.idAwayTeam || '') === String(teamId)
        ? Number.isFinite(time) && time < cutoff && e.intHomeScore != null && e.intAwayScore != null &&
          Number.isFinite(Number(e.intHomeScore)) && Number.isFinite(Number(e.intAwayScore)) &&
          !['CANC', 'POSTP', 'ABD'].includes(e.strStatus)
        : false;
    };
    const scheduled = Array.isArray(scheduleEvents) ? scheduleEvents.filter(complete).sort((a,b) =>
      (Date.parse(b.strTimestamp || b.dateEvent) || 0) - (Date.parse(a.strTimestamp || a.dateEvent) || 0)).slice(0,n) : [];
    if (scheduled.length >= 5) {
      return { ok:true, source:'sportsdb-team-schedule', data:{ response:scheduled.map(toAnalysisFixture) }, teamId,
        historyAudit:scheduled.slice(0,5).map(e => ({ eventId:e.idEvent, date:e.strTimestamp || e.dateEvent,
          homeTeam:e.strHomeTeam, awayTeam:e.strAwayTeam, homeTeamId:e.idHomeTeam, awayTeamId:e.idAwayTeam,
          homeScore:e.intHomeScore, awayScore:e.intAwayScore, league:e.strLeague })) };
    }
    const lastResult = await getTeamLastEvents(teamId);
    if (lastResult.ok) {
      const rawEvents = (lastResult.data && (lastResult.data.results || lastResult.data.events)) || [];
      const finishedEvents = rawEvents.filter(function (e) {
        const hasScore = e.intHomeScore !== null && e.intHomeScore !== undefined &&
          e.intAwayScore !== null && e.intAwayScore !== undefined;
        const belongsToTeam = String(e.idHomeTeam || '') === String(teamId) ||
          String(e.idAwayTeam || '') === String(teamId);
        return belongsToTeam && (e.strStatus === 'FT' || hasScore);
      }).sort(function (a, b) {
        const aTime = Date.parse(a.strTimestamp || a.dateEvent || '') || 0;
        const bTime = Date.parse(b.strTimestamp || b.dateEvent || '') || 0;
        return bTime - aTime;
      });
      if (finishedEvents.length > 0) {
        const lastEvents = finishedEvents.slice(0, n);
        return {
          ok: true,
          source: 'sportsdb-last-events',
          data: { response: lastEvents.map(toAnalysisFixture) },
          teamId: teamId,
          historyAudit: lastEvents.slice(0, 5).map(function (e) {
            return {
              eventId: e.idEvent || null,
              date: e.strTimestamp || e.dateEvent || null,
              homeTeam: e.strHomeTeam || null,
              awayTeam: e.strAwayTeam || null,
              homeTeamId: e.idHomeTeam || null,
              awayTeamId: e.idAwayTeam || null,
              homeScore: e.intHomeScore ?? null,
              awayScore: e.intAwayScore ?? null,
              league: e.strLeague || null,
            };
          }),
        };
      }
    }
  }

  // --- Fallback: eski yontem (ligin son olaylari icinden isimle filtrele) ---
  const tsdbLeagueId = tsdbLeagueIdOverride || LEAGUE_ID_MAP[String(fotmobLeagueId)];
  if (!tsdbLeagueId) {
    return { ok: false, error: 'league_not_mapped' };
  }

  const result = await getLeaguePastEvents(tsdbLeagueId);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  const events = (result.data && result.data.events) || [];
  const normalized = normalizeTeamName(teamName);

  function isMatch(name) {
    return name && normalizeTeamName(name).indexOf(normalized) !== -1;
  }

  const teamEvents = events.filter(function (e) {
    return e.strStatus === 'FT' && (isMatch(e.strHomeTeam) || isMatch(e.strAwayTeam));
  });

  let resolvedTeamId = teamId || null;
  if (!resolvedTeamId) {
    for (let i = 0; i < teamEvents.length; i++) {
      const e = teamEvents[i];
      if (isMatch(e.strHomeTeam)) { resolvedTeamId = e.idHomeTeam; break; }
      if (isMatch(e.strAwayTeam)) { resolvedTeamId = e.idAwayTeam; break; }
    }
  }

  const lastEvents = teamEvents.sort(function (a, b) {
    const aTime = Date.parse(a.strTimestamp || a.dateEvent || '') || 0;
    const bTime = Date.parse(b.strTimestamp || b.dateEvent || '') || 0;
    return bTime - aTime;
  }).slice(0, n);

  return {
    ok: true,
    source: 'sportsdb-league-history',
    data: { response: lastEvents.map(toAnalysisFixture) },
    teamId: resolvedTeamId,
  };
}

// ============================================================================
// PRO/PREMIUM V2 EK VERILER: mac zaman cizelgesi, istatistikler, kadrolar,
// TV yayin bilgisi, one cikanlar (highlights), tam sezon fikstürleri.
// Onemli: bu veriler TheSportsDB'nin API-Football ile eslestirdigi buyuk
// liglerde mevcut - kucuk/az bilinen liglerdeki maclarda genelde BOS doner.
// Bu bir hata degil, TheSportsDB'nin kendi veri kapsamiyla ilgili bir sinir -
// asagidaki fonksiyonlarin hepsi bu durumda { available: false, ... } donup
// hicbir seyi kirmadan sessizce devam eder.
// ============================================================================

async function getEventTimeline(eventId) {
  return fetchV2('/lookup/event_timeline/' + eventId, 8000);
}

async function getEventStats(eventId) {
  return fetchV2('/lookup/event_stats/' + eventId, 8000);
}

async function getEventLineup(eventId) {
  return fetchV2('/lookup/event_lineup/' + eventId, 8000);
}

async function getEventTV(eventId) {
  return fetchV2('/lookup/event_tv/' + eventId, 8000);
}

async function getEventHighlights(eventId) {
  return fetchV2('/lookup/event_highlights/' + eventId, 8000);
}

async function getTeamSeasonSchedule(teamId) {
  return fetchV2('/schedule/full/team/' + teamId, 10000);
}

async function getLeagueSeasonSchedule(tsdbLeagueId, season) {
  return fetchV2('/schedule/league/' + tsdbLeagueId + '/' + encodeURIComponent(season), 10000);
}

/** strTimeline degerini (Goal/subst/Yellow Card/Red Card vb.) sabit bir tipe cevirir */
function normalizeTimelineType(rawType) {
  const raw = String(rawType || '').toLowerCase();
  if (raw.indexOf('goal') !== -1) return 'goal';
  if (raw.indexOf('subst') !== -1 || raw.indexOf('sub') !== -1) return 'substitution';
  if (raw.indexOf('yellow') !== -1) return 'yellow_card';
  if (raw.indexOf('red') !== -1) return 'red_card';
  return 'other';
}

function transformTimelineItem(item) {
  return {
    minute: item.intTime !== null && item.intTime !== undefined ? parseInt(item.intTime, 10) : null,
    type: normalizeTimelineType(item.strTimeline),
    detail: item.strTimelineDetail || '',
    isHome: item.strHome === 'Yes',
    team: item.strTeam || '',
    player: item.strPlayer || '',
    assist: item.strAssist || null,
  };
}

/**
 * Bir macin gol/kart/oyuncu degisikligi zaman cizelgesini doner.
 * @param {string|number} eventId
 */
async function getEventTimelineFormatted(eventId) {
  const result = await getEventTimeline(eventId);
  if (!result.ok) return { ok: true, available: false, events: [] };
  // V2 responses use `timeline`; older/alternate responses used `lookup`.
  // Accept both so real goal events are not silently discarded.
  const data = result.data || {};
  const raw = data.timeline || data.lookup || data.events || [];
  const events = raw.map(transformTimelineItem).sort(function (a, b) { return (a.minute || 0) - (b.minute || 0); });
  return { ok: true, available: events.length > 0, events: events };
}

// Ilk yari skoru icin eventsday.php/eventspastleague.php HICBIR ZAMAN veri
// vermiyor (yukarida transformEvent'te aciklandigi gibi) - tek kaynak, mac
// zaman cizelgesindeki (event_timeline) gollerin dakikasi. Bu yuzden:
// dakikasi 45'i gecmeyen gollari "ilk yari" sayip topluyoruz. Zaman
// cizelgesi kucuk liglerde cogu zaman BOS/eksik geliyor - bu durumda ilk
// yariyi tahmin etmek yerine null donduruyoruz (yanlis "0-0" gostermek,
// hic gostermemekten daha kotu). Ayrica guvenlik icin: zaman cizelgesinden
// sayilan TOPLAM gol sayisi, mac sonu skoruyla tutmuyorsa (cizelge eksikse
// bu olur) yine null donuyoruz.
const HALFTIME_CACHE_TTL = config.cache.ttlPrecomputed; // 6 saat - bitmis bir macin ilk yarisi degismez, sadece kota korumak icin makul bir sure
const HALFTIME_UNAVAILABLE_TTL = 60 * 60; // 1 saat - veri o an yoksa da her istekte tekrar denemesin, ama kalici da kilitlenmesin

async function computeHalftimeScore(eventId, finalHome, finalAway) {
  const cacheKey = `halftime:${eventId}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  const timeline = await getEventTimelineFormatted(eventId);
  let result = { home: null, away: null };

  if (timeline.available) {
    const goals = timeline.events.filter(function (ev) { return ev.type === 'goal'; });
    let totalHome = 0, totalAway = 0, htHome = 0, htAway = 0;
    goals.forEach(function (g) {
      if (g.isHome) totalHome++; else totalAway++;
      if (g.minute !== null && g.minute <= 45) {
        if (g.isHome) htHome++; else htAway++;
      }
    });

    const scoreMatches = finalHome == null || finalAway == null ||
      (totalHome === finalHome && totalAway === finalAway);

    if (scoreMatches) {
      result = { home: htHome, away: htAway };
    }
  }

  cache.set(cacheKey, result, result.home !== null ? HALFTIME_CACHE_TTL : HALFTIME_UNAVAILABLE_TTL);
  return result;
}

/**
 * Bir mac listesindeki (transformEvent/applyLiveOverlay ciktisi), ilk yari
 * skoru henuz bilinmeyen ve suresi dolmus/en az ilk yariyi gecmis maclar
 * icin ilk yari skorunu doldurur. Ayni anda cok fazla premium API istegi
 * atmamak icin (kota: dakikada sinirli istek) kucuk gruplar halinde,
 * sirayla isleniyor - cogu zaten cache'den donecegi icin bu yavaslik
 * sadece ilk kez gorulen maclarda bir kereye mahsus yasaniyor.
 * @param {Array} matches
 */
async function attachHalftimeScores(matches) {
  const CONCURRENCY = 4;
  const candidates = matches.filter(function (m) {
    const pastHalftime = m.statusShort === 'FT' || (m.isLive && m.minute != null && m.minute > 45);
    const atHalfTime=m.statusShort==='HT';
    return (pastHalftime||atHalfTime) && (m.halftimeHome === null || m.halftimeHome === undefined) && m.fixtureId;
  });

  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    const batch = candidates.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async function (m) {
      let ht = { home:null, away:null };
      // The live feed often omits HT; lookup-event carries the provider's
      // official half-time fields. Cache found details and retry misses briefly.
      const detailKey = 'sportsdb-detail:' + String(m.fixtureId);
      let detail = cache.get(detailKey);
      if (detail === undefined) {
        detail = await getEventById(m.fixtureId).catch(function () { return { ok:false }; });
        cache.set(detailKey, detail, detail?.ok ? HALFTIME_CACHE_TTL : 60);
      }
      const event = detail?.ok ? (detail.data?.events || [])[0] : null;
      const direct = event ? transformEvent(event) : null;
      if (m.statusShort === 'HT' && m.homeScore != null && m.awayScore != null) {
        // At the provider's explicit HT state, the current score is the
        // official first-half score.
        ht = { home:Number(m.homeScore), away:Number(m.awayScore) };
        m.halftimeSource = 'sportsdb-live-ht-state';
      } else if (direct?.halftimeHome != null && direct?.halftimeAway != null) {
        ht = { home:direct.halftimeHome, away:direct.halftimeAway };
        m.halftimeSource = 'sportsdb-event-detail';
      } else {
        ht = await computeHalftimeScore(m.fixtureId, m.homeScore, m.awayScore);
        if (ht.home != null && ht.away != null) m.halftimeSource = 'sportsdb-timeline';
      }
      m.halftimeHome = ht.home;
      m.halftimeAway = ht.away;
    }));
  }

  return matches;
}

// TheSportsDB'nin strStat metnini bizim sabit anahtarlarimiza esler.
const STAT_LABEL_MAP = {
  'shots on goal': 'shotsOnTarget',
  'total shots': 'totalShots',
  'corner kicks': 'corners',
  'ball possession': 'possession',
  fouls: 'fouls',
  offsides: 'offsides',
  'yellow cards': 'yellowCards',
  'red cards': 'redCards',
  'goalkeeper saves': 'saves',
  expected_goals: 'xg',
};

function transformStats(rawList) {
  const out = {};
  rawList.forEach(function (item) {
    const label = String(item.strStat || '').trim().toLowerCase();
    const key = STAT_LABEL_MAP[label];
    if (!key) return;
    const home = item.intHome !== null && item.intHome !== undefined ? parseFloat(item.intHome) : null;
    const away = item.intAway !== null && item.intAway !== undefined ? parseFloat(item.intAway) : null;
    out[key] = { home: home, away: away };
  });
  return out;
}

/**
 * Bir macin gercek istatistiklerini doner (sut, korner, top hakimiyeti,
 * faul, xG vb.) - onceden bunlar hep 0/50-50 sabitti, artik gercek.
 */
async function getEventStatsFormatted(eventId) {
  const result = await getEventStats(eventId);
  if (!result.ok) return { ok: true, available: false, stats: {} };
  const raw = (result.data && result.data.lookup) || [];
  if (!raw.length) return { ok: true, available: false, stats: {} };
  return { ok: true, available: true, stats: transformStats(raw) };
}

function transformLineupItem(item) {
  return {
    player: item.strPlayer || '',
    position: item.strPosition || '',
    positionShort: item.strPositionShort || '',
    squadNumber: item.intSquadNumber || null,
    isHome: item.strHome === 'Yes',
    isSubstitute: item.strSubstitute === 'Yes',
    photo: item.strCutout || null,
  };
}

/** Bir macin ilk 11 + yedek kadrolarini (ev/deplasman ayri) doner */
async function getEventLineupFormatted(eventId) {
  const result = await getEventLineup(eventId);
  if (!result.ok) return { ok: true, available: false, home: [], away: [], homeSubs: [], awaySubs: [] };
  const raw = (result.data && result.data.lookup) || [];
  if (!raw.length) return { ok: true, available: false, home: [], away: [], homeSubs: [], awaySubs: [] };

  const mapped = raw.map(transformLineupItem);
  return {
    ok: true,
    available: true,
    home: mapped.filter(function (p) { return p.isHome && !p.isSubstitute; }),
    away: mapped.filter(function (p) { return !p.isHome && !p.isSubstitute; }),
    homeSubs: mapped.filter(function (p) { return p.isHome && p.isSubstitute; }),
    awaySubs: mapped.filter(function (p) { return !p.isHome && p.isSubstitute; }),
  };
}

function transformTVItem(item) {
  return {
    channel: item.strChannel || '',
    country: item.strCountry || '',
    logo: item.strLogo || null,
    time: item.strTime || null,
    date: item.dateEvent || null,
  };
}

/** Bir macin hangi TV kanallarinda yayinlandigini/yayinlanacagini doner */
async function getEventTVFormatted(eventId) {
  const result = await getEventTV(eventId);
  if (!result.ok) return { ok: true, available: false, broadcasts: [] };
  const raw = (result.data && result.data.lookup) || [];
  return { ok: true, available: raw.length > 0, broadcasts: raw.map(transformTVItem) };
}

/** Bir macin YouTube one cikanlar (highlights) videosunu doner */
async function getEventHighlightsFormatted(eventId) {
  const result = await getEventHighlights(eventId);
  if (!result.ok) return { ok: true, available: false, videoUrl: null };
  const raw = (result.data && result.data.lookup) || [];
  const first = raw[0];
  const videoUrl = first && first.strVideo ? first.strVideo : null;
  return { ok: true, available: !!videoUrl, videoUrl: videoUrl };
}

function transformScheduleEvent(e) {
  const homeScore = e.intHomeScore !== null && e.intHomeScore !== undefined ? parseInt(e.intHomeScore, 10) : null;
  const awayScore = e.intAwayScore !== null && e.intAwayScore !== undefined ? parseInt(e.intAwayScore, 10) : null;
  return {
    fixtureId: e.idEvent,
    date: e.dateEvent || (e.strTimestamp || '').slice(0, 10),
    kickoff: toUtcIso(e.strTimestamp),
    league: e.strLeague || '',
    round: e.intRound || null,
    homeTeam: e.strHomeTeam || '',
    awayTeam: e.strAwayTeam || '',
    homeScore: homeScore,
    awayScore: awayScore,
    finished: homeScore !== null && awayScore !== null,
    video: e.strVideo || null,
  };
}

/**
 * Bir takimin TUM sezon fikstürünü doner (gecmis + gelecek maclar, max 250
 * kayit). eventslast.php'nin aksine (sadece son 10 mac) form disi analizler
 * icin (orn. gelecek fikstür yogunlugu, motivasyon) kullanislidir.
 */
async function getTeamSeasonScheduleFormatted(teamId) {
  const result = await getTeamSeasonSchedule(teamId);
  if (!result.ok) return { ok: true, available: false, events: [] };
  const raw = Array.isArray(result.data) ? result.data : ((result.data && result.data.schedule) || []);
  return { ok: true, available: raw.length > 0, events: raw.map(transformScheduleEvent) };
}

/**
 * Bir ligin TUM sezon fikstürünü doner (max 3000 kayit).
 * @param {number} tsdbLeagueId
 * @param {string} season - orn. '2025-2026'
 */
async function getLeagueSeasonScheduleFormatted(tsdbLeagueId, season) {
  const result = await getLeagueSeasonSchedule(tsdbLeagueId, season);
  if (!result.ok) return { ok: true, available: false, events: [] };
  const raw = Array.isArray(result.data) ? result.data : ((result.data && result.data.schedule) || []);
  return { ok: true, available: raw.length > 0, events: raw.map(transformScheduleEvent) };
}

/** V1 lookuptable.php - lig puan durumu (siralama, aci farki, "description" alani dahil) */
async function getLeagueStandings(tsdbLeagueId, season) {
  const url = BASE_URL + '/' + API_KEY + '/lookuptable.php?l=' + tsdbLeagueId + '&s=' + encodeURIComponent(season);
  return fetchT(url, 10000);
}

function transformStandingRow(row) {
  return {
    teamId: row.idTeam,
    teamName: row.strTeam,
    rank: row.intRank ? parseInt(row.intRank, 10) : null,
    points: row.intPoints ? parseInt(row.intPoints, 10) : null,
    played: row.intPlayed ? parseInt(row.intPlayed, 10) : null,
    goalDiff: row.intGoalDifference ? parseInt(row.intGoalDifference, 10) : null,
    // API-Football'un "description" alaninin (orn. "Promotion - Champions
    // League") esdegeri - motivationService bunu ayni sekilde okuyor.
    description: row.strDescription || null,
  };
}

/**
 * Bir ligin puan durumunu doner (motivasyon hesabi icin kullanilir).
 * API-Football'un standings'i askida/kota dolu oldugu icin hep bos
 * donuyordu - bu, isMappedLeague olan ligler icin onun yerini alir.
 * @param {number} tsdbLeagueId
 * @param {string} season - orn. '2026-2027'
 */
async function getLeagueStandingsFormatted(tsdbLeagueId, season) {
  const result = await getLeagueStandings(tsdbLeagueId, season);
  if (!result.ok) return { ok: true, available: false, table: [] };
  const raw = (result.data && result.data.table) || [];
  return { ok: true, available: raw.length > 0, table: raw.map(transformStandingRow) };
}

/**
 * TheSportsDB sezon formatini ('2026-2027' gibi) bugunun tarihine gore
 * hesaplar. Avrupa liglerinin cogu Temmuz-Agustos'ta basladigi icin
 * Temmuz oncesi bir onceki sezon, Temmuz ve sonrasi mevcut sezon kabul
 * edilir.
 */
function getCurrentSeasonString(referenceDate) {
  const d = referenceDate || new Date();
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1; // 1-12
  return month >= 7 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

// LEAGUE_ID_MAP'in tersi: TheSportsDB idLeague -> FotMob leagueId.
// Frontend TheSportsDB ID'sini biliyor (matches/results verisinden), ama
// analysisEngine FotMob ID'si bekliyor - bu fonksiyon ikisi arasinda koprudur.
function getFotmobIdForTsdbLeague(tsdbLeagueId) {
  for (const [fotmobId, tsdbId] of Object.entries(LEAGUE_ID_MAP)) {
    if (String(tsdbId) === String(tsdbLeagueId)) return fotmobId;
  }
  return null;
}

module.exports = {
  getMatchesByDate,
  getEventById,
  transformEvent,
  applyLiveOverlay,
  toUtcIso,
  getTeamFixturesForAnalysis,
  getLeaguePastEvents,
  getFotmobIdForTsdbLeague,
  getLiveScores,
  transformLiveEvent,
  getEventTimelineFormatted,
  attachHalftimeScores,
  getEventStatsFormatted,
  getEventLineupFormatted,
  getEventTVFormatted,
  getEventHighlightsFormatted,
  getTeamSeasonScheduleFormatted,
  getLeagueSeasonScheduleFormatted,
  getLeagueStandingsFormatted,
  getCurrentSeasonString,
  isWhitelistedLeague,
  isLeagueIdentityConsistent,
  WHITELISTED_LEAGUE_IDS,
  LEAGUE_ID_MAP,
};
