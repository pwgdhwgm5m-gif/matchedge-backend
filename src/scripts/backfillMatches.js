/**
 * backfillMatches.js
 * Son N gunun maclarini free-api-live-football-data kaynagindan cekip
 * veritabanina yazar. server.js icindeki /run-backfill route'u tarafindan
 * cagrilir (Render free plan Shell/SSH desteklemedigi icin).
 */

const Match = require('../models/Match');
const freeFootballApi = require('../services/freeFootballApiService');
const { normalizeTeamName } = require('../utils/textNormalize');

const DAYS_BACK = 45;
const DELAY_MS = 1200;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDate(d) {
  return d.toISOString().split('T')[0];
}

async function runBackfill() {
  console.log(`Backfill basliyor: son ${DAYS_BACK} gun`);

  let totalSaved = 0;
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
        if (!finished) continue;

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
          // duplicate - atla
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
  return { totalSaved, totalErrors };
}

module.exports = { runBackfill };
