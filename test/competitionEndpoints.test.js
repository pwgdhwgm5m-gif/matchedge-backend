const assert = require('node:assert/strict');
const test = require('node:test');

const cache = require('../src/utils/cache');
const sportsDb = require('../src/services/sportsDbService');
const bsdService = require('../src/services/bsdService');
const matchesRouter = require('../src/routes/matches');
const liveRouter = require('../src/routes/live');

function routeHandler(router, path = '/') {
  const layer = router.stack.find(item => item.route?.path === path);
  const route = layer?.route?.stack.find(item => item.method === 'get');
  assert.ok(route, `GET ${path} route exists`);
  return route.handle;
}

function responseCapture() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('fixture endpoint deduplicates verified cross-provider cup rows', async () => {
  const original = {
    getOrFetch: cache.getOrFetch,
    transformEvent: sportsDb.transformEvent,
    isWhitelistedLeague: sportsDb.isWhitelistedLeague,
    applyLiveOverlay: sportsDb.applyLiveOverlay
  };
  const tsdbFixture = {
    fixtureId: 'tsdb-cup-1', leagueId: '4483', league: 'Copa del Rey',
    homeTeam: 'Lebrijana', awayTeam: 'Ceuta 6 de Junio',
    kickoff: '2026-09-26T16:00:00Z'
  };
  const bsdFixture = {
    fixtureId: 'bsd-cup-1', bsdEventId: 'bsd-cup-1', leagueId: '41',
    league: 'Copa del Rey', leagueCountry: 'Spain',
    homeTeam: 'UB Lebrijana', awayTeam: 'CD 6 de Junio',
    kickoff: '2026-09-26T16:00:00+00:00'
  };

  try {
    sportsDb.transformEvent = () => tsdbFixture;
    sportsDb.isWhitelistedLeague = () => true;
    sportsDb.applyLiveOverlay = matches => matches;
    cache.getOrFetch = async key => {
      if (key.startsWith('fixtures:')) return { ok: true, data: { events: [{}] } };
      if (key === 'live:v2:all') return { ok: false };
      if (key.startsWith('cup-fixtures:')) return { ok: true, matches: [] };
      if (key.startsWith('odds-events:')) return { ok: true, matches: [] };
      if (key.startsWith('sportmonks:tr:600:')) return { ok: false, fixtures: [] };
      if (key.startsWith('sportmonks:date:')) return { ok: false, fixtures: [] };
      if (key.startsWith('bsd:canonical-results:')) return { ok: true, matches: [bsdFixture] };
      return { ok: false };
    };

    const response = responseCapture();
    await routeHandler(matchesRouter)({ query: { date: '2026-09-26' } }, response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.matches.length, 1);
    assert.equal(response.body.matches[0].canonicalCompetitionKey, 'spain-copa-del-rey');
    assert.equal(response.body.matches[0].displayName, 'Copa del Rey');
    assert.equal(response.body.matches[0].canonicalProvider, 'bsd');
    assert.equal(response.body.matches[0].providerIds.sportsdb, 'tsdb-cup-1');
    assert.equal(response.body.matches[0].providerIds.bsd, 'bsd-cup-1');
  } finally {
    cache.getOrFetch = original.getOrFetch;
    sportsDb.transformEvent = original.transformEvent;
    sportsDb.isWhitelistedLeague = original.isWhitelistedLeague;
    sportsDb.applyLiveOverlay = original.applyLiveOverlay;
  }
});

test('fixture endpoint includes a BSD Eerste Divisie match with an unmapped numeric league ID', async () => {
  const originalGetOrFetch = cache.getOrFetch;
  try {
    cache.getOrFetch = async key => key.startsWith('bsd:canonical-results:')
      ? {ok: true, matches: [{
          fixtureId: 'bsd-dordrecht-almere', bsdEventId: 'bsd-dordrecht-almere',
          leagueId: 'provider-league-id', league: 'Eerste Divisie', leagueCountry: 'Netherlands',
          homeTeam: 'FC Dordrecht', awayTeam: 'Almere City', date: '2026-09-25T19:00:00Z'
        }]}
      : {ok: false, fixtures: [], matches: []};
    const response = responseCapture();
    await routeHandler(matchesRouter)({query: {date: '2026-09-25'}}, response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.matches.length, 1);
    assert.equal(response.body.matches[0].canonicalCompetitionKey, 'netherlands-eerste-divisie');
    assert.equal(response.body.matches[0].visibleInCompetitionFilter, true);
    assert.equal(response.body.matches[0].canonicalProvider, 'bsd');
  } finally {
    cache.getOrFetch = originalGetOrFetch;
  }
});

test('fixture endpoint retains a BSD live match missing from its day feed', async () => {
  const originalGetOrFetch = cache.getOrFetch;
  try {
    cache.getOrFetch = async key => key === 'bsd:fixture-live:canonical'
      ? {ok:true,matches:[{
          fixtureId:'bsd-live-only',bsdEventId:'bsd-live-only',league:'Keuken Kampioen Divisie',
          leagueCountry:'Netherlands',leagueId:'live-league-id',
          homeTeam:'FC Dordrecht',awayTeam:'Almere City',date:'2026-09-25T19:00:00Z',isLive:true
        }]}
      : {ok:false,fixtures:[],matches:[]};
    const response=responseCapture();
    await routeHandler(matchesRouter)({query:{date:'2026-09-25'}},response);
    assert.equal(response.body.matches.length,1);
    assert.equal(response.body.matches[0].canonicalCompetitionKey,'netherlands-eerste-divisie');
    assert.equal(response.body.matches[0].visibleInCompetitionFilter,true);
  } finally {cache.getOrFetch=originalGetOrFetch;}
});

test('fixture endpoint uses a verified live fallback when BSD has no Eerste Divisie event', async () => {
  const original = {getOrFetch:cache.getOrFetch, transformLiveEvent:sportsDb.transformLiveEvent};
  try {
    sportsDb.transformLiveEvent = () => ({fixtureId:'2489840',leagueId:'4641',
      league:'Dutch Eerste Divisie',homeTeam:'Dordrecht',awayTeam:'Almere City',
      kickoff:'2026-09-25T19:00:00Z',isLive:true});
    cache.getOrFetch = async key => key === 'live:v2:all'
      ? {ok:true,data:{livescore:[{strSport:'Soccer'}]}}
      : {ok:false,fixtures:[],matches:[]};
    const response=responseCapture();
    await routeHandler(matchesRouter)({query:{date:'2026-09-25'}},response);
    assert.equal(response.body.matches.length,1);
    assert.equal(response.body.matches[0].canonicalCompetitionKey,'netherlands-eerste-divisie');
    assert.equal(response.body.matches[0].visibleInCompetitionFilter,true);
    assert.equal(response.body.matches[0].providerIds.sportsdb,'2489840');
  } finally {cache.getOrFetch=original.getOrFetch;sportsDb.transformLiveEvent=original.transformLiveEvent;}
});

test('fixture endpoint transforms a verified SportsDB event and rejects an ID/name mismatch', async () => {
  const originalGetOrFetch = cache.getOrFetch;
  const events = [
    {
      idEvent: 'tsdb-belgian-cup-1',
      idLeague: '5831',
      strLeague: 'Belgian Cup',
      dateEvent: '2026-09-26',
      strTime: '16:00:00',
      strStatus: 'NS',
      strHomeTeam: 'Berlare',
      strAwayTeam: 'Latem',
      intHomeScore: null,
      intAwayScore: null
    },
    {
      idEvent: 'wrong-league-id-1',
      idLeague: '5831',
      strLeague: 'English League One',
      dateEvent: '2026-09-26',
      strTime: '17:00:00',
      strHomeTeam: 'Wrong Home',
      strAwayTeam: 'Wrong Away'
    }
  ];

  try {
    cache.getOrFetch = async key => {
      if (key.startsWith('fixtures:')) return { ok: true, data: { events } };
      if (key === 'live:v2:all') return { ok: false };
      if (key.startsWith('cup-fixtures:')) return { ok: true, matches: [] };
      if (key.startsWith('odds-events:')) return { ok: false, matches: [] };
      if (key.startsWith('sportmonks:tr:600:')) return { ok: false, fixtures: [] };
      if (key.startsWith('sportmonks:date:')) return { ok: false, fixtures: [] };
      if (key.startsWith('bsd:canonical-results:')) return { ok: false, matches: [] };
      return { ok: false };
    };

    const response = responseCapture();
    await routeHandler(matchesRouter)({ query: { date: '2026-09-26' } }, response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.matches.length, 1);
    assert.equal(response.body.matches[0].fixtureId, 'tsdb-belgian-cup-1');
    assert.equal(response.body.matches[0].canonicalCompetitionKey, 'belgium-cup');
    assert.equal(response.body.matches[0].mappingStatus, 'verified');
    assert.equal(response.body.matches[0].fixtureCoverage, 'fixture-producing');
    assert.equal(response.body.matches[0].visibleInCompetitionFilter, true);
  } finally {
    cache.getOrFetch = originalGetOrFetch;
  }
});

test('live endpoint keeps lower-priority competitions visible and merges provider aliases', async () => {
  const original = {
    getOrFetch: cache.getOrFetch,
    transformLiveEvent: sportsDb.transformLiveEvent,
    extractList: bsdService.extractList,
    eventToResultMatch: bsdService.eventToResultMatch
  };
  const tsdbMls = {
    fixtureId: 'tsdb-mls-1', leagueId: '4346', league: 'American Major League Soccer',
    homeTeam: 'Seattle Sounders', awayTeam: 'Real Salt Lake',
    kickoff: '2026-09-24T19:00:00Z', isLive: true, minute: 45
  };
  const bsdMls = {
    fixtureId: 'bsd-mls-1', bsdEventId: 'bsd-mls-1', leagueId: '18',
    league: 'MLS', leagueCountry: 'United States',
    homeTeam: 'Seattle Sounders FC', awayTeam: 'Real Salt Lake',
    kickoff: '2026-09-24T19:00:00Z', isLive: true, minute: 46
  };
  const bsdNwsl = {
    fixtureId: 'bsd-nwsl-1', bsdEventId: 'bsd-nwsl-1', leagueId: '72',
    league: 'NWSL', leagueCountry: 'United States',
    homeTeam: 'Chicago Stars', awayTeam: 'Orlando Pride',
    kickoff: '2026-09-24T20:00:00Z', isLive: true, minute: 30
  };
  const bsdEerste = {
    fixtureId:'bsd-eerste-1',bsdEventId:'bsd-eerste-1',leagueId:'provider-eerste-id',
    league:'Eerste Divisie',leagueCountry:'Netherlands',homeTeam:'FC Dordrecht',
    awayTeam:'Almere City',kickoff:'2026-09-24T19:00:00Z',isLive:true,minute:35
  };
  const sportmonksMatch = {
    fixtureId: 'sm-pl-1', sportmonksId: 'sm-pl-1', leagueId: '8',
    leagueName: 'Premier League', homeTeam: 'Arsenal', awayTeam: 'Chelsea',
    kickoff: '2026-09-24T20:00:00Z', isLive: true, minute: 22
  };

  try {
    sportsDb.transformLiveEvent = () => tsdbMls;
    bsdService.extractList = () => [bsdMls, bsdNwsl, bsdEerste];
    bsdService.eventToResultMatch = event => event;
    cache.getOrFetch = async key => {
      if (key === 'live:v2:all') return { ok: true, data: { livescore: [{ strSport: 'Soccer' }] } };
      if (key === 'sportmonks:inplay') return { ok: true, fixtures: [sportmonksMatch] };
      if (key === 'bsd:fixture-live:canonical') return { ok: true, matches: [bsdMls, bsdNwsl, bsdEerste] };
      return { ok: false };
    };

    const response = responseCapture();
    await routeHandler(liveRouter)({ query: {} }, response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.matches.length, 3);
    const mls = response.body.matches.find(match => match.canonicalCompetitionKey === 'usa-mls');
    assert.ok(mls);
    assert.equal(mls.canonicalProvider, 'bsd');
    assert.equal(mls.providerIds.bsd, 'bsd-mls-1');
    assert.equal(mls.providerIds.thesportsdb, 'tsdb-mls-1');
    assert.ok(response.body.matches.some(match => match.canonicalCompetitionKey === 'netherlands-eerste-divisie'));
    assert.ok(response.body.matches.some(match => match.canonicalCompetitionKey === 'england-premier-league'));
  } finally {
    cache.getOrFetch = original.getOrFetch;
    sportsDb.transformLiveEvent = original.transformLiveEvent;
    bsdService.extractList = original.extractList;
    bsdService.eventToResultMatch = original.eventToResultMatch;
  }
});
