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

async function getLivescores() {
  const result = await request('/livescores', {
    include: 'participants;scores;statistics.type;periods;events',
  });
  if (!result.ok) return result;
  return { ok: true, fixtures: (result.data?.data || []).map(transformFixture) };
}

module.exports = { request, getInplay, getLivescores, transformFixture };
