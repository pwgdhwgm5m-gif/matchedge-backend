const cron = require('node-cron');
const config = require('../config/config');
const cache = require('../utils/cache');
const footballApi = require('../services/footballApiService');
const oddsApi = require('../services/oddsApiService');
const sportsDb = require('../services/sportsDbService');
const { computeFullAnalysis } = require('../services/analysisEngine');

const PRECOMPUTE_TSDB_LEAGUES = {
  '4339': '71',   // Türkiye Süper Lig (TFF scraper)
  '4328': '47',   // Premier League
  '4335': '87',   // La Liga
  '4332': '55',   // Serie A
  '4331': '54',   // Bundesliga
  '4334': '53',   // Ligue 1
  '4337': '57',   // Eredivisie
  '4336': '135',  // Yunanistan Super League
  '4358': '59',   // Norvec Eliteserien
  '4347': '67',   // Isvec Allsvenskan
  '4422': '196',  // Polonya Ekstraklasa
  '4355': '63',   // Rusya Premier Lig
  '4344': '61',   // Portekiz Liga Portugal
  '4636': '51',   // Finlandiya Veikkausliiga
  '4338': '40',   // Belcika First Division A
  '4340': '46',   // Danimarka Superligaen
  '4330': '64',   // Iskocya Premiership
};

const DAYS_AHEAD = 7;

function formatDate(d) {
  return d.toISOString().split('T')[0];
}

async function precomputeTodaysMatches() {
  console.log(`[precompute] Onumuzdeki ${DAYS_AHEAD} gun taraniyor (TheSportsDB)...`);

  const upcomingFixtures = [];

  for (let i = 0; i < DAYS_AHEAD; i++) {
    const date = new Date();
    date.setDate(date.getDate() + i);
    const dateStr = formatDate(date);

    const result = await sportsDb.getMatchesByDate(dateStr);
    if (!result.ok) {
      console.error(`[precompute] ${dateStr}: fikstur cekilemedi, atlaniyor.`);
      continue;
    }

    const events = (result.data && result.data.events) || [];
    events.forEach(function (e) {
      if (e.strStatus !== 'NS') return;
      const fotmobLeague = PRECOMPUTE_TSDB_LEAGUES[String(e.idLeague)];
      if (!fotmobLeague) return;

      upcomingFixtures.push({
        fixtureId: e.idEvent,
        home: e.idHomeTeam,
        away: e.idAwayTeam,
        homeTeamName: e.strHomeTeam,
        awayTeamName: e.strAwayTeam,
        league: fotmobLeague,
        season: new Date().getFullYear(),
        kickoff: e.strTimestamp || (e.dateEvent + 'T' + (e.strTime || '00:00:00')),
      });
    });
  }

  console.log(`[precompute] ${upcomingFixtures.length} uygun mac bulundu (${Object.keys(PRECOMPUTE_TSDB_LEAGUES).length} lig).`);

  const MAX_FIXTURES_PER_RUN = config.maxPrecomputeFixturesPerRun;
  const prioritized = upcomingFixtures
    .sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff))
    .slice(0, MAX_FIXTURES_PER_RUN);

  if (upcomingFixtures.length > MAX_FIXTURES_PER_RUN) {
    console.log(`[precompute] Kota korumasi: ${upcomingFixtures.length} mactan ilk ${MAX_FIXTURES_PER_RUN} tanesi onden hesaplanacak.`);
  }

  for (const fixture of prioritized) {
    try {
      const result = await computeFullAnalysis({
        fixtureId: fixture.fixtureId,
        home: fixture.home,
        away: fixture.away,
        homeTeamName: fixture.homeTeamName,
        awayTeamName: fixture.
