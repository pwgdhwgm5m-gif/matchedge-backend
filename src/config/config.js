require('dotenv').config();

module.exports = {
  port: process.env.PORT || 10000,
  nodeEnv: process.env.NODE_ENV || 'development',

  apiFootball: {
    // API-Football'a iki farkli sekilde baglanilabilir: RapidAPI uzerinden
    // veya api-sports.io'dan DOGRUDAN. Ikisi ayri hesap/kota sayilir, farkli
    // header ve adres kullanir. Her ikisini de ayni anda tanimlayabilirsin -
    // biri kota hatasi (429) verirse sistem otomatik digerine gecer.
    sources: [
      // RapidAPI anahtarlari - virgulle birden fazla da girilebilir
      ...(process.env.API_FOOTBALL_KEY || '')
        .split(',')
        .map(k => k.trim())
        .filter(Boolean)
        .map(key => ({
          key,
          type: 'rapidapi',
          baseUrl: 'https://api-football-v1.p.rapidapi.com/v3',
          headers: (k) => ({
            'x-rapidapi-key': k,
            'x-rapidapi-host': process.env.API_FOOTBALL_HOST || 'api-football-v1.p.rapidapi.com',
          }),
        })),
      // Ikinci (farkli hesapla acilmis) RapidAPI anahtari
      ...(process.env.API_FOOTBALL_KEY_2 ? [{
        key: process.env.API_FOOTBALL_KEY_2.trim(),
        type: 'rapidapi',
        baseUrl: 'https://api-football-v1.p.rapidapi.com/v3',
        headers: (k) => ({
          'x-rapidapi-key': k,
          'x-rapidapi-host': process.env.API_FOOTBALL_HOST || 'api-football-v1.p.rapidapi.com',
        }),
      }] : []),
      // Dogrudan api-sports.io anahtarlari (dashboard.api-football.com) -
      // virgulle birden fazla da girilebilir, farkli header/adres kullanir
      ...(process.env.API_FOOTBALL_DIRECT_KEY || '')
        .split(',')
        .map(k => k.trim())
        .filter(Boolean)
        .map(key => ({
          key,
          type: 'direct',
          baseUrl: 'https://v3.football.api-sports.io',
          headers: (k) => ({ 'x-apisports-key': k }),
        })),
    ],
  },

  // Gunun maclarini/sonuclarini cekmek icin kullanilan ikinci (yedek/ana)
  // kaynak - "Free API Live Football Data" (RapidAPI). API-Football hesap
  // sorunlari yasandiginda (askiya alinma, abonelik) devreye girer.
  // Su an /api/results, /api/matches ve /api/live BU kaynagi kullaniyor -
  // API-Football'dan daha guvenilir calisiyor.
  freeFootballApi: {
    key: process.env.FREE_FOOTBALL_API_KEY || '',
    baseUrl: 'https://free-api-live-football-data.p.rapidapi.com',
    host: 'free-api-live-football-data.p.rapidapi.com',
  },

  oddsApi: {
    key: process.env.ODDS_API_KEY,
    baseUrl: 'https://api.the-odds-api.com/v4',
  },

  sportsDb: {
    key: process.env.THESPORTSDB_KEY || '3',
    baseUrl: 'https://www.thesportsdb.com/api/v1/json',
  },

  cache: {
    ttlStatic: parseInt(process.env.CACHE_TTL_STATIC || '900', 10),      // 15 dk
    ttlLive: parseInt(process.env.CACHE_TTL_LIVE || '45', 10),           // 45 sn
    ttlPrecomputed: parseInt(process.env.CACHE_TTL_PRECOMPUTED || '21600', 10), // 6 saat
  },

  // Oran hareketi grafigi icin periyodik olarak takip edilecek ligler.
  // The Odds API'nin sport key formatinda: https://the-odds-api.com/sports-odds-data/sports-apis.html
  // NOT: UAE Pro League The Odds API'de mevcut degil, eklenemedi.
  // NOT: Bazi ulkelerin (Turkiye, Rusya, Hollanda, Portekiz, Kore, Japonya, Cin dahil)
  // sadece 1. ligi The Odds API'de var, 2. lig sunulmuyor.
  // NOT: Liste ~35 antite icerir (lig + kupa + turnuva). Snapshot cron'u
  // ("oddsSnapshotCron") bu yuzden varsayilan olarak seyrek (3 saatte bir)
  // tutuluyor - yoksa ucretsiz aylik kota (~500 istek) hizla tukenir.
  // AYRICA: akilli filtre sayesinde (bkz. oddsApiService.hasMatchesToday)
  // sadece o gun gercekten maci olan ligler icin gercek oran istegi yapiliyor,
  // bu da kota tuketimini ciddi oranda azaltiyor.
  trackedLeagues: (process.env.TRACKED_LEAGUES || [
    // --- Avrupa 1. Ligler ---
    'soccer_epl',                    // Ingiltere
    'soccer_spain_la_liga',          // Ispanya
    'soccer_italy_serie_a',          // Italya
    'soccer_germany_bundesliga',     // Almanya
    'soccer_france_ligue_one',       // Fransa
    'soccer_netherlands_eredivisie', // Hollanda
    'soccer_portugal_primeira_liga', // Portekiz
    'soccer_belgium_first_div',      // Belcika
    'soccer_austria_bundesliga',     // Avusturya
    'soccer_denmark_superliga',      // Danimarka
    'soccer_finland_veikkausliiga',  // Finlandiya
    'soccer_greece_super_league',    // Yunanistan
    'soccer_norway_eliteserien',     // Norvec
    'soccer_poland_ekstraklasa',     // Polonya
    'soccer_sweden_allsvenskan',     // Isvec
    'soccer_switzerland_superleague',// Isvicre
    'soccer_spl',                    // Iskocya
    'soccer_turkey_super_league',    // Turkiye
    'soccer_russia_premier_league',  // Rusya
    'soccer_australia_aleague',      // Avustralya
    'soccer_korea_kleague1',         // Kore
    'soccer_japan_j_league',         // Japonya
    'soccer_china_superleague',      // Cin
    // --- UEFA / Ozel Turnuvalar ---
    'soccer_uefa_champs_league',               // Sampiyonlar Ligi
    'soccer_uefa_champs_league_qualification', // Sampiyonlar Ligi Elemeleri
    'soccer_uefa_europa_league',               // Avrupa Ligi
    'soccer_uefa_europa_conference_league',    // Konferans Ligi
    'soccer_uefa_nations_league',              // Uluslar Ligi
    // --- Buyuk Ulusal Kupalar ---
    'soccer_fa_cup',                 // Ingiltere
    'soccer_england_efl_cup',        // Ingiltere Lig Kupasi
    'soccer_germany_dfb_pokal',      // Almanya
    'soccer_italy_coppa_italia',     // Italya
    'soccer_france_coupe_de_france', // Fransa
    'soccer_spain_copa_del_rey',     // Ispanya
  ].join(','))
    .split(',')
    .map(s => s.trim()),

  // Oran snapshot cron ifadesi. Kota tuketimini kontrol altinda tutmak icin
  // varsayilan 3 saatte bir (gunde 8 kez x lig sayisi kadar istek).
  oddsSnapshotCron: process.env.ODDS_SNAPSHOT_CRON || '0 */3 * * *',

  // Onden hesaplama (precompute) turu basina islenecek maksimum mac sayisi.
  // computeFullAnalysis mac basina 4-5 API-Football istegi yapiyor, bu yuzden
  // ucretsiz kota (~100 istek/gun) icin bu sayi dusuk tutulmali.
  maxPrecomputeFixturesPerRun: parseInt(process.env.MAX_PRECOMPUTE_FIXTURES_PER_RUN || '15', 10),

  // --- Kullanici hesabi / veritabani ---
  mongoUri: process.env.MONGODB_URI || '',
  jwtSecret: process.env.JWT_SECRET || '',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '30d',

  backfillSecret: process.env.BACKFILL_SECRET || '',

  // --- E-posta (dogrulama + sifre sifirlama) ---

  resendApiKey: process.env.RESEND_API_KEY || '',
  emailFrom: process.env.EMAIL_FROM || 'MatchEdge <onboarding@resend.dev>',
  // Dogrulama/sifirlama e-postalarindaki baglantilarin isaret edecegi
  // frontend adresi. Frontend'i nereye yuklediysen (Render Static Site,
  // Netlify vb.) o adresi buraya yaz - sonuna slash koyma.
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5500',
};
