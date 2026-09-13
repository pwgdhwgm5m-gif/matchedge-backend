const cron = require('node-cron');
const config = require('../config/config');
const cache = require('../utils/cache');
const footballApi = require('../services/footballApiService');
const oddsApi = require('../services/oddsApiService');
const { computeFullAnalysis } = require('../services/analysisEngine');

/**
 * Gunun fikstÃ¼rlerini tarar, her mac icin TAM analiz motorunu
 * (computeFullAnalysis - /api/analysis route'uyla AYNI fonksiyon)
 * onceden calistirip cache'e uzun TTL ile yazar. Kullanici sayfayi
 * actiginda canli hesaplama yapmaz, sadece hazir sonucu okur ->
 * sayfa acilisi hizli olur. Onceden bu fonksiyon basit sabit
 * degerler kullaniyordu - artik anlik istekle BIREBIR AYNI gelismis
 * modeli (motivasyon, yorgunluk, form, sakatlik, Dixon-Coles, piyasa
 * harmani) kullaniyor, boylece iki yol arasinda tutarsizlik kalmadi.
 */
async function precomputeTodaysMatches() {
  const today = new Date().toISOString().split('T')[0];
  console.log(`[precompute] ${today} fiksturleri taraniyor...`);

  const fixturesResult = await footballApi.getFixturesByDate(today);
  if (!fixturesResult.ok) {
    console.error('[precompute] Fikstur cekilemedi, bu tur atlaniyor.');
    return;
  }

  const fixtures = fixturesResult.data?.response || [];
  console.log(`[precompute] ${fixtures.length} mac bulundu.`);

  // GUVENLIK SINIRI: computeFullAnalysis artik mac basina 4-5 API-Football
  // istegi yapiyor (h2h, sakatlik, ev formu, deplasman formu, +standings).
  // Ucretsiz plan (~100 istek/gun) ile sinirsiz calistirmak kotayi tek
  // turda bitirebilir. En yakin zamanli maclari onceliklendirip ilk
  // MAX_FIXTURES_PER_RUN kadarini isliyoruz - geri kalani kullanici
  // sayfayi actiginda /api/analysis'in "realtime" yoluyla hesaplanir
  // (biraz daha yavas ama calisir, veri kaybi olmaz).
  const MAX_FIXTURES_PER_RUN = config.maxPrecomputeFixturesPerRun;
  const prioritized = [...fixtures]
    .sort((a, b) => new Date(a.fixture.date) - new Date(b.fixture.date))
    .slice(0, MAX_FIXTURES_PER_RUN);

  if (fixtures.length > MAX_FIXTURES_PER_RUN) {
    console.log(`[precompute] Kota korumasi: ${fixtures.length} mactan ilk ${MAX_FIXTURES_PER_RUN} tanesi onden hesaplanacak.`);
  }

  for (const fixture of prioritized) {
    try {
      const fixtureId = fixture.fixture.id;

      const result = await computeFullAnalysis({
        fixtureId,
        home: fixture.teams.home.id,
        away: fixture.teams.away.id,
        homeTeamName: fixture.teams.home.name,
        awayTeamName: fixture.teams.away.name,
        league: fixture.league.id,
        season: fixture.league.season,
        // NOT: API-Football lig ID'si ile The Odds API'nin sport_key'i
        // farkli sistemler - otomatik eslestirme yok. Belirtmezsek
        // varsayilan soccer_epl denenir, takim adlari eslesmezse
        // piyasa harmani sessizce atlanip sadece model kullanilir
        // (hata vermez, sadece o mac icin blend olmaz).
      });

      const precomputed = {
        ...result,
        homeTeam: fixture.teams.home.name,
        awayTeam: fixture.teams.away.name,
        kickoff: fixture.fixture.date,
        computedAt: new Date().toISOString(),
      };

      cache.set(`precomputed:${fixtureId}`, precomputed, config.cache.ttlPrecomputed);
    } catch (err) {
      console.error(`[precompute] Mac ${fixture.fixture.id} icin hata:`, err.message);
    }
  }

  console.log('[precompute] Tur tamamlandi.');
}

/** Render free tier'in uykuya gecmesini engellemek icin kendi kendine ping atar */
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
  // Her gun 06:00 ve 13:00'te calisir (sunucu saat dilimi UTC olabilir, dikkat)
  cron.schedule('0 6,13 * * *', precomputeTodaysMatches);
  console.log('[precompute] Cron zamanlandi: her gun 06:00 ve 13:00');

  // Sunucu ilk ayaga kalktiginda da bir kere hemen calistir
  precomputeTodaysMatches();
}

/**
 * Oran hareketi grafigi icin ayarlanan araliklarla (varsayilan 3 saat)
 * takip edilen liglerin anlik oranini kaydeder. Zamanla biriken bu
 * kayitlar grafik olusturur. Kac ligin takip edildigine gore kota
 * tuketimi degisir - config.js'deki yorumlara bak.
 */
function startOddsSnapshotCron() {
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

  // Ilk kaydi hemen al, cron'un ilk calismasini beklemeden grafik veri toplamaya baslasin
  config.trackedLeagues.forEach(sportKey => oddsApi.recordOddsSnapshot(sportKey));
}

module.exports = { startPrecomputeCron, startKeepAlive, startOddsSnapshotCron, precomputeTodaysMatches };
