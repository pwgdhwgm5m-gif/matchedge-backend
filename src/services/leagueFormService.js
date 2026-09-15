/**
 * leagueFormService.js
 * Veritabaninda biriken Match kayitlarindan (backfillMatches.js ve
 * gunluk cron toplama ile dolan) bir takimin form/istatistik verisini
 * uretir. API-Football yerine kullanilir, statsService.js'in bekledigi
 * {ok, data:{response:[...]}} formatinda doner - analysisEngine.js
 * icin footballApi.getTeamForm() ile ayni sozlesmeyi saglar.
 */

const Match = require('../models/Match');
const { normalizeTeamName } = require('../utils/textNormalize');

/**
 * @param {string} teamName - takim adi (herhangi bir yazimla, normalize edilir)
 * @param {number} leagueId - free-api-live-football-data lig ID'si
 * @param {number} count - kac son mac dondurulsun
 */
async function getTeamFixturesForAnalysis(teamName, leagueId, count) {
  const n = count || 15;
  try {
    const normalized = normalizeTeamName(teamName);

    const matches = await Match.find({
      leagueId: leagueId,
      finished: true,
      $or: [
        { homeTeamNameNormalized: normalized },
        { awayTeamNameNormalized: normalized },
      ],
    })
      .sort({ kickoff: -1 })
      .limit(n)
      .lean();

    // en eskiden en yeniye sirala (statsService bu sirayi bekliyor)
    const sorted = matches.reverse();

    const response = sorted.map((m) => ({
      fixture: { id: m.fixtureId, date: m.kickoff.toISOString() },
      teams: {
        home: { id: m.homeTeamNameNormalized, name: m.homeTeamName },
        away: { id: m.awayTeamNameNormalized, name: m.awayTeamName },
      },
      goals: { home: m.homeScore, away: m.awayScore },
      score: { halftime: { home: null, away: null } },
    }));

    // resolvedTeamId: normalize edilmis isim, statsService'in ev/deplasman
    // ayrimi yapabilmesi icin tutarli bir kimlik olarak kullaniliyor
    return {
      ok: true,
      data: { response: response },
      teamId: normalized,
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { getTeamFixturesForAnalysis };
