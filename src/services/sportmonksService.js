const axios = require('axios');

const BASE_URL = 'https://api.sportmonks.com/v3/football';

function token() {
  return process.env.SPORTMONKS_API_TOKEN || '';
}

async function request(path, params = {}) {
  if (!token()) return { ok: false, error: 'SPORTMONKS_API_TOKEN missing', data: null };
  try {
    const response = await axios.get(`${BASE_URL}${path}`, {
      params: { ...params, api_token: token() },
      timeout: 12000,
    });
    return { ok: true, data: response.data };
  } catch (err) {
    return {
      ok: false,
      error: err.response?.data?.message || err.message,
      status: err.response?.status || null,
      data: null,
    };
  }
}

function scoreValue(scores, participant) {
  const rows = Array.isArray(scores) ? scores : [];
  const row = rows.find(s => {
    const d = String(s.description || '').toUpperCase();
    const p = String(s.score?.participant || s.participant || '').toLowerCase();
    return d === 'CURRENT' && p === participant;
  });
  return row?.score?.goals ?? row?.goals ?? null;
}

function halftimeValue(scores, participant) {
  const rows = Array.isArray(scores) ? scores : [];
  const row = rows.find(s => {
    const d = String(s.description || '').toUpperCase();
    const p = String(s.score?.participant || s.participant || '').toLowerCase();
    return ['1ST_HALF','1ST HALF','HALFTIME','HT'].includes(d) && p === participant;
  });
  return row?.score?.goals ?? row?.goals ?? null;
}

function participantName(fixture, location) {
  const p = (fixture.participants || []).find(x =>
    String(x.meta?.location || x.location || '').toLowerCase() === location
  );
  return p?.name || null;
}

function participantId(f, location) {
  return (f.participants || []).find(p => String(p.meta?.location || p.location || '').toLowerCase() === location)?.id ?? null;
}

function statisticValue(f, labels, participant) {
  const rows = Array.isArray(f.statistics) ? f.statistics : [];
  const wanted = labels.map(x => x.toLowerCase());
  const row = rows.find(s => {
    const name = String(s.type?.developer_name || s.type?.name || s.type?.code || s.name || '').toLowerCase().replace(/_/g,' ');
    const loc = String(s.location || s.meta?.location || '').toLowerCase();
    const pid = s.participant_id ?? s.participant?.id ?? null;
    const expectedId = participantId(f, participant);
    const sideMatches = pid != null && expectedId != null ? String(pid) === String(expectedId) : (!loc || loc === participant);
    return wanted.some(w => name === w || name.includes(w)) && sideMatches;
  });
  const v = row?.data?.value ?? row?.value ?? null;
  const n = Number(String(v ?? '').replace('%',''));
  return Number.isFinite(n) ? n : null;
}

function transformFixture(f) {
  const scores = f.scores || [];
  return {
    sportmonksId: f.id,
    leagueId: f.league_id,
    seasonId: f.season_id,
    homeTeam: participantName(f, 'home'),
    awayTeam: participantName(f, 'away'),
    homeScore: scoreValue(scores, 'home'),
    awayScore: scoreValue(scores, 'away'),
    halftimeHome: halftimeValue(scores, 'home'),
    halftimeAway: halftimeValue(scores, 'away'),
    kickoff: f.starting_at || null,
    stateId: f.state_id,
    stats: {
      shotsOnTargetHome: statisticValue(f,['shots on target','shots-on-target'],'home'),
      shotsOnTargetAway: statisticValue(f,['shots on target','shots-on-target'],'away'),
      shotsHome: statisticValue(f,['shots total','total shots'],'home'),
      shotsAway: statisticValue(f,['shots total','total shots'],'away'),
      cornersHome: statisticValue(f,['corners','corner kicks'],'home'),
      cornersAway: statisticValue(f,['corners','corner kicks'],'away'),
      possessionHome: statisticValue(f,['ball possession','possession'],'home'),
      possessionAway: statisticValue(f,['ball possession','possession'],'away'),
      shotsOffTargetHome: statisticValue(f,['shots off target','shots-off-target'],'home'),
      shotsOffTargetAway: statisticValue(f,['shots off target','shots-off-target'],'away'),
      attacksHome: statisticValue(f,['attacks'],'home'),
      attacksAway: statisticValue(f,['attacks'],'away'),
      dangerousAttacksHome: statisticValue(f,['dangerous attacks','dangerous-attacks'],'home'),
      dangerousAttacksAway: statisticValue(f,['dangerous attacks','dangerous-attacks'],'away'),
      blockedShotsHome: statisticValue(f,['shots blocked','blocked shots'],'home'),
      blockedShotsAway: statisticValue(f,['shots blocked','blocked shots'],'away'),
      shotsInsideBoxHome: statisticValue(f,['shots insidebox','shots inside box'],'home'),
      shotsInsideBoxAway: statisticValue(f,['shots insidebox','shots inside box'],'away'),
      shotsOutsideBoxHome: statisticValue(f,['shots outsidebox','shots outside box'],'home'),
      shotsOutsideBoxAway: statisticValue(f,['shots outsidebox','shots outside box'],'away'),
      bigChancesHome: statisticValue(f,['big chances created','big chances'],'home'),
      bigChancesAway: statisticValue(f,['big chances created','big chances'],'away'),
      bigChancesMissedHome: statisticValue(f,['big chances missed'],'home'),
      bigChancesMissedAway: statisticValue(f,['big chances missed'],'away'),
      savesHome: statisticValue(f,['saves'],'home'),
      savesAway: statisticValue(f,['saves'],'away'),
      foulsHome: statisticValue(f,['fouls'],'home'),
      foulsAway: statisticValue(f,['fouls'],'away'),
      offsidesHome: statisticValue(f,['offsides'],'home'),
      offsidesAway: statisticValue(f,['offsides'],'away'),
    },
    raw: f,
  };
}

async function getInplay() {
  const result = await request('/livescores/inplay', {
    include: 'participants;scores;statistics.type;periods;events',
  });
  if (!result.ok) return result;
  return { ok: true, fixtures: (result.data?.data || []).map(transformFixture) };
}

async function getFixtureIntelligence(fixtureId) {
  if (!fixtureId) return { ok:false, error:'fixture_id_missing' };
  const result = await request('/fixtures/' + fixtureId, {
    include: 'participants;lineups.player;events.type;statistics.type;sidelined.sideline',
  });
  if (!result.ok) return result;
  const f = result.data?.data || {};
  const participants = f.participants || [];
  const side = id => String(participants.find(p => String(p.id) === String(id))?.meta?.location || '').toLowerCase();
  const lineups = Array.isArray(f.lineups) ? f.lineups : [];
  const starters = loc => lineups.filter(x => side(x.team_id || x.participant_id) === loc && (x.type_id === 11 || x.formation_position || x.starter === true))
    .map(x => ({ id:x.player_id || x.player?.id, name:x.player?.display_name || x.player?.name || null, position:x.position_id || null }));
  const events = Array.isArray(f.events) ? f.events : [];
  const reds = loc => events.filter(e => side(e.participant_id || e.team_id) === loc && /red/i.test(String(e.type?.name || e.type?.developer_name || e.type || ''))).length;
  return { ok:true, fixtureId:f.id, homeStarters:starters('home'), awayStarters:starters('away'), homeRedCards:reds('home'), awayRedCards:reds('away'), rawStatistics: transformFixture(f).stats };
}

async function getLivescores() {
  const result = await request('/livescores', {
    include: 'participants;scores;statistics.type;periods;events',
  });
  if (!result.ok) return result;
  return { ok: true, fixtures: (result.data?.data || []).map(transformFixture) };
}


function normalizeName(s='') {
  return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/\b(fc|cf|afc|sc|fk|sk|ac|as)\b/g,'').replace(/[^a-z0-9]/g,'');
}

function findMatch(fixtures, home, away) {
  const h=normalizeName(home), a=normalizeName(away);
  return (fixtures || []).find(f => {
    const fh=normalizeName(f.homeTeam), fa=normalizeName(f.awayTeam);
    return (fh===h || fh.includes(h) || h.includes(fh)) &&
           (fa===a || fa.includes(a) || a.includes(fa));
  }) || null;
}

async function getVerifiedLiveData(home, away) {
  const r = await getInplay();
  if (!r.ok) return { available:false, error:r.error, status:r.status || null };
  const match=findMatch(r.fixtures,home,away);
  if (!match) return { available:false };
  return { available:true, match };
}

module.exports = { request, getInplay, getLivescores, getFixtureIntelligence, transformFixture, findMatch, getVerifiedLiveData };
