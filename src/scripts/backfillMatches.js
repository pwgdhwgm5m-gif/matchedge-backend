/**
 * backfillMatches.js
 * Tek seferlik calistirilir: son N gunun maclarini free-api-live-football-data
 * kaynagindan cekip veritabanina yazar. API-Football'in askida olmasi
 * nedeniyle diger liglerde form verisi olmadigi icin bu script gecmisi
 * doldurup analysisEngine'in dogru calismasini saglar.
 *
 * Calistirmak icin (Render Shell'de veya lokal):
 *   node src/scripts/backfillMatches.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const config = require('../config/config');
const { connectDB } = require('../db');
const Match = require('../models/Match');
const freeFootballApi = require('../services/freeFootballApiService');
const { normalizeTeamName } = require('../utils/textNormalize');

const DAYS_BACK = 45;
const DELAY_MS = 1200; // her istek arasinda bekleme - rate limit'e takilmamak icin

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDate(d) {
  return d.toISOString().split('T')[0];
}

async function run() {
  await connectDB();
  console.log(`Backfill basliyor: son ${DAYS_BACK} gun`);

  let totalSaved = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (let i = DAYS_BACK; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = formatDate(date);

    try {
      const result = await freeFootballApi.getMatchesByDate(dateStr);
      if (!result.ok) {
        console.log(`${dateStr}: fetch basarisiz, atlaniyor`);
        totalErrors++;
        await sleep(DELAY_MS);
        continue;
      }

      const rawMatches = result.data?.response?.matches || [];
      let savedThisDay = 0;

      for (const m of rawMatches) {
        const finished = !!m.status?.finished;
        if (!finished) continue; // sadece bitmis maclari kaydet

        const homeTeam = m.home?.name || m.home?.longName || '';
        const awayTeam = m.away?.name || m.away?.longName || '';
        if (!homeTeam || !awayTeam) continue;

        try {
          await Match.updateOne(
            { fixtureId: String(m.id) },
            {
              $setOnInsert: {
                fixtureId: String(m.id),
                leagueId: m.leagueId,
                kickoff: m.status?.utcTime ? new Date(m.status.utcTime) : date,
                homeTeamName: homeTeam,
                awayTeamName: awayTeam,
                homeTeamNameNormalized: normalizeTeamName(homeTeam),
                awayTeamNameNormalized: normalizeTeamName(awayTeam),
                homeScore: m.home?.score ?? null,
                awayScore: m.away?.score ?? null,
                finished: true,
              },
            },
            { upsert: true }
          );
          savedThisDay++;
        } catch (err) {
          // duplicate key gibi hatalar - atla
        }
      }

      totalSaved += savedThisDay;
      console.log(`${dateStr}: ${savedThisDay} mac kaydedildi`);
    } catch (err) {
      console.error(`${dateStr}: hata - ${err.message}`);
      totalErrors++;
    }

    await sleep(DELAY_MS);
  }

  console.log(`Backfill tamamlandi. Toplam kaydedilen: ${totalSaved}, hata: ${totalErrors}`);
  await mongoose.connection.close();
  process.exit(0);
}

run().catch((err) => {
  console.error('Backfill hatasi:', err);
  process.exit(1);
});
