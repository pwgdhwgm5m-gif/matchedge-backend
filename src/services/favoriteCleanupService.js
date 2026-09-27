const Favorite = require('../models/Favorite');
const ProviderIdentity = require('../models/ProviderIdentity');
const bsd = require('./bsdService');
const sportsDb = require('./sportsDbService');
const cache = require('../utils/cache');
const {normalizeTeamIdentity} = require('./competitionRegistryService');

const istanbulDay = now => new Date(now + 3 * 60 * 60 * 1000).toISOString().slice(0,10);
const istanbulMidnightUtc = day => Date.parse(day + 'T00:00:00Z') - 3 * 60 * 60 * 1000;
const idsOf = row => [...new Set([row.fixtureId,...Object.values(row.providerIds||{})].filter(Boolean).map(String))];
const teamsOf = row => [normalizeTeamIdentity(row.homeTeam||row.home),normalizeTeamIdentity(row.awayTeam||row.away)];

function finishedFavoriteIds(favorites, results, identities, cutoff) {
  const confirmed = new Set();
  for (const result of results) {
    const kickoff = Date.parse(result.kickoff||result.date||'');
    const status = String(result.statusShort||result.status||'').toUpperCase();
    if (!Number.isFinite(kickoff) || kickoff >= cutoff ||
        !['FT','AET','PEN','AWARDED','FINISHED','COMPLETED'].includes(status) ||
        result.homeScore == null || result.awayScore == null ||
        !Number.isFinite(Number(result.homeScore)) || !Number.isFinite(Number(result.awayScore))) continue;
    const [home,away] = teamsOf(result);
    if (!home || !away) continue;
    const ids = new Set(idsOf(result));
    for (const identity of identities) {
      const identityIds = idsOf(identity);
      if (!identityIds.some(id=>ids.has(id))) continue;
      const identityKickoff = Date.parse(identity.kickoff||'');
      const [ih,ia] = teamsOf(identity);
      if (ih===home && ia===away && Number.isFinite(identityKickoff) &&
          Math.abs(identityKickoff-kickoff)<=15*60*1000) identityIds.forEach(id=>ids.add(id));
    }
    for (const favorite of favorites) {
      const [fh,fa] = teamsOf(favorite);
      if (fh===home && fa===away && ids.has(String(favorite.fixtureId))) confirmed.add(favorite._id);
    }
  }
  return [...confirmed];
}

async function cleanupFinishedFavorites(now=Date.now()) {
  const favorites = await Favorite.find({}).select('_id fixtureId homeTeam awayTeam').lean();
  if (!favorites.length) return 0;
  const ids = [...new Set(favorites.map(f=>String(f.fixtureId)))];
  const identities = await ProviderIdentity.find({$or:['bsd','sportsdb','thesportsdb','sportmonks']
    .map(provider=>({[`providerIds.${provider}`]:{$in:ids}}))})
    .select('kickoff home away providerIds').lean();
  const today = istanbulDay(now), cutoff = istanbulMidnightUtc(today);
  const results = [];
  // Include recent legacy favorites that were saved without a kickoff date.
  for (let daysAgo=1; daysAgo<=14; daysAgo+=1) {
    const day = new Date(Date.parse(today+'T00:00:00Z')-daysAgo*86400000).toISOString().slice(0,10);
    const [bsdDay, sportsDbDay] = await Promise.all([
      cache.getOrFetch(`bsd:canonical-results:${day}`,300,()=>bsd.getResultMatchesForDate(day)),
      cache.getOrFetch(`fixtures:${day}`,3600,()=>sportsDb.getMatchesByDate(day))
    ]);
    if (bsdDay?.ok) results.push(...(bsdDay.matches||[]));
    if (sportsDbDay?.ok) results.push(...(sportsDbDay.data?.events||[]).map(sportsDb.transformEvent));
  }
  const confirmedIds = finishedFavoriteIds(favorites,results,identities,cutoff);
  if (!confirmedIds.length) return 0;
  const deleted = await Favorite.deleteMany({_id:{$in:confirmedIds}});
  return deleted.deletedCount||0;
}

module.exports = {cleanupFinishedFavorites,finishedFavoriteIds,istanbulDay,istanbulMidnightUtc};
