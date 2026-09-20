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
  // SportMonks v3 represents period scores primarily with description
  // "1ST_HALF" / "1ST_HALF_ONLY" and participant in score.participant.
  // Some plans/responses expose numeric type ids instead of descriptions.
  const candidates = rows.filter(s => {
    const raw = String(s.description || s.type?.developer_name || s.type?.name || '')
      .toUpperCase().replace(/[- ]+/g,'_').replace(/_+/g,'_').trim();
    const p = String(s.score?.participant || s.participant || s.location || '').toLowerCase();
    if (p !== participant) return false;
    return raw === '1ST_HALF' || raw === '1ST_HALF_ONLY' || raw === 'FIRST_HALF' ||
      raw === 'HALFTIME' || raw === 'HALF_TIME' || raw === 'HT' ||
      raw.includes('1ST_HALF') || raw.includes('FIRST_HALF');
  });
  const row = candidates[0];
  return row?.score?.goals ?? row?.goals ?? row?.value ?? null;
}

function halftimeFromPeriods(periods, participant) {
  const rows = Array.isArray(periods) ? periods : [];
  const first = rows.find(p => {
    const t = String(p.type?.developer_name || p.type?.name || p.description || p.type || '')
      .toUpperCase().replace(/[- ]+/g,'_');
    return t === '1ST_HALF' || t === 'FIRST_HALF' || t === '1H' || Number(p.type_id) === 1;
  });
  if (!first) return null;
  const score = first.score || first.scores || {};
  const v = participant === 'home'
    ? (score.home ?? score.home_score ?? first.home_score ?? first.home)
    : (score.away ?? score.away_score ?? first.away_score ?? first.away);
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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
    homeTeamId: participantId(f, 'home'),
    awayTeamId: participantId(f, 'away'),
    homeScore: scoreValue(scores, 'home'),
    awayScore: scoreValue(scores, 'away'),
    halftimeHome: halftimeValue(scores, 'home') ?? halftimeFromPeriods(f.periods, 'home'),
    halftimeAway: halftimeValue(scores, 'away') ?? halftimeFromPeriods(f.periods, 'away'),
    kickoff: f.starting_at || null,
    stateId: f.state_id,
    // SportMonks state ids: 1 NS, 2 1H, 3 HT, 4 BREAK, 5 FT,
    // 6 ET, 7 PEN, 8 FT after ET, 9 FT after pens, 10 postponed,
    // 11 suspended, 12 cancelled, 13 TBD, 14 interrupted, 15 abandoned,
    // 16 delayed, 17 awarded, 18 2H, 19 awaiting updates, 20 deleted,
    // 21 extra-time break, 22 1ET, 23 ET break, 24 2ET, 25 pen break, 26 pens.
    statusShort: [5,8,9,17].includes(Number(f.state_id)) ? 'FT'
      : [2,3,4,6,18,21,22,23,24,25,26].includes(Number(f.state_id)) ? 'LIVE'
      : [10,11,12,14,15,16,20].includes(Number(f.state_id)) ? 'CANCELLED'
      : 'NS',
    isLive: [2,3,4,6,18,21,22,23,24,25,26].includes(Number(f.state_id)),
    minute: (() => {
      const periods = Array.isArray(f.periods) ? f.periods : [];
      const active = [...periods].reverse().find(p => p.ticking === true || p.ended === null || p.ended_at == null);
      const rawMinute = active?.minutes ?? active?.minute ?? f?.time?.minute ?? null;
      const n = Number(rawMinute);
      return Number.isFinite(n) ? n : null;
    })(),
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
    .replace(/ı/g,'i').replace(/\b(fc|cf|afc|sc|fk|sk|ac|as)\b/g,'').replace(/spor$/g,'').replace(/[^a-z0-9]/g,'');
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

async function getTeamFixtureHistory(teamId, days = 120) {
  if (!teamId) return { ok:false, error:'team_id_missing', fixtures:[] };
  const end = new Date();
  const start = new Date(end.getTime() - Math.max(30, days) * 86400000);
  const iso = d => d.toISOString().slice(0,10);
  const result = await request('/fixtures/between/' + iso(start) + '/' + iso(end) + '/' + teamId, {
    include: 'participants;scores;statistics.type',
  });
  if (!result.ok) return result;
  const fixtures = (result.data?.data || []).map(transformFixture)
    .filter(x => x.homeScore != null && x.awayScore != null)
    .sort((a,b) => new Date(b.kickoff) - new Date(a.kickoff));
  return { ok:true, fixtures };
}

function aggregateTeamHistory(fixtures, teamId) {
  const rows = Array.isArray(fixtures) ? fixtures : [];
  const keys=['shotsOnTarget','shots','corners','cornersAgainst','shotsOnTargetAgainst','shotsAgainst','blockedShotsAgainst','shotsInsideBoxAgainst','bigChancesAgainst','dangerousAttacksAgainst','shotsOffTarget','attacks','dangerousAttacks','blockedShots','shotsInsideBox','bigChances'];
  const values = [];

  for (const [index, f] of rows.slice(0,14).entries()) {
    const raw = f.raw || {};
    const homeId = participantId(raw,'home');
    const awayId = participantId(raw,'away');
    const loc = String(homeId) === String(teamId) ? 'Home' : String(awayId) === String(teamId) ? 'Away' : null;
    if (!loc) continue;
    const pick = key => f.stats?.[key + loc] ?? null;
    const oppLoc = loc === 'Home' ? 'Away' : 'Home';
    const pickOpp = key => f.stats?.[key + oppLoc] ?? null;
    // Recency decay: newest completed matches matter more, without discarding
    // the older sample that stabilises early-season analysis.
    const recencyWeight = Math.pow(0.90, index);
    values.push({
      venue: loc.toLowerCase(), recencyWeight,
      shotsOnTarget: pick('shotsOnTarget'), shots: pick('shots'), corners: pick('corners'),
      cornersAgainst: pickOpp('corners'), shotsOnTargetAgainst: pickOpp('shotsOnTarget'), shotsAgainst: pickOpp('shots'),
      blockedShotsAgainst: pickOpp('blockedShots'), shotsInsideBoxAgainst: pickOpp('shotsInsideBox'), bigChancesAgainst: pickOpp('bigChances'),
      dangerousAttacksAgainst: pickOpp('dangerousAttacks'),
      shotsOffTarget: pick('shotsOffTarget'), attacks: pick('attacks'), dangerousAttacks: pick('dangerousAttacks'),
      blockedShots: pick('blockedShots'), shotsInsideBox: pick('shotsInsideBox'), bigChances: pick('bigChances')
    });
  }

  const summarize = subset => {
    const averages={};
    for (const k of keys) {
      const valid=subset.filter(v=>Number.isFinite(v[k]));
      const totalWeight=valid.reduce((s,v)=>s+v.recencyWeight,0);
      averages[k]=totalWeight
        ? +(valid.reduce((s,v)=>s+v[k]*v.recencyWeight,0)/totalWeight).toFixed(2)
        : null;
    }
    return { sample:subset.length, averages };
  };

  const overall=summarize(values);
  const home=summarize(values.filter(v=>v.venue==='home'));
  const away=summarize(values.filter(v=>v.venue==='away'));
  return { ...overall, home, away, weighting:'recency-0.90', window:14 };
}


async function getFixturesByDate(date) {
  if (!date) return { ok:false, error:'date_missing', fixtures:[] };
  // One request covers every league included in the account subscription.
  // Do not hard-code league IDs here: SportMonks itself is the entitlement boundary.
  const all=[]; let page=1;
  while(page<=20){
    const result=await request('/fixtures/date/'+date,{include:'participants;scores;periods',page,per_page:50});
    if(!result.ok)return result;
    const body=result.data||{},rows=Array.isArray(body.data)?body.data:[];
    all.push(...rows.map(transformFixture));
    const p=body.pagination||{};
    if(p.has_more!==true||rows.length===0)break;
    page=Number(p.current_page||page)+1;
  }
  const unique=new Map();for(const x of all)unique.set(String(x.sportmonksId),x);
  return {ok:true,fixtures:[...unique.values()]};
}

function enrichMatches(matches, sportmonksFixtures) {
  return (matches||[]).map(m=>{
    const sm=findMatch(sportmonksFixtures,m.homeTeam,m.awayTeam);
    if(!sm)return m;
    const out={...m,sportmonksId:sm.sportmonksId,sportmonksLeagueId:sm.leagueId};
    if(sm.homeScore!=null&&sm.awayScore!=null){out.homeScore=sm.homeScore;out.awayScore=sm.awayScore;out.scoreSource='sportmonks';}
    if(sm.halftimeHome!=null&&sm.halftimeAway!=null){out.halftimeHome=sm.halftimeHome;out.halftimeAway=sm.halftimeAway;out.halftimeSource='sportmonks';}
    return out;
  });
}

async function getLeagueFixturesBetween(leagueId,start,end){
 if(!leagueId)return {ok:false,error:'league_id_missing',fixtures:[]};
 // SportMonks allows at most 100 days per date-range request. Split longer
 // backfills into safe windows, then paginate each window.
 const all=[]; const from=new Date(start+'T00:00:00Z'), until=new Date(end+'T00:00:00Z');
 const iso=d=>d.toISOString().slice(0,10);
 for(let cursor=new Date(from);cursor<=until;){
  const windowEnd=new Date(Math.min(until.getTime(),cursor.getTime()+99*86400000));
  let page=1;
  while(page<=100){
   const result=await request('/fixtures/between/'+iso(cursor)+'/'+iso(windowEnd),{include:'participants;scores;statistics.type',filters:'fixtureLeagues:'+leagueId,page,per_page:50});
   if(!result.ok)return result;
   const body=result.data||{}, rows=Array.isArray(body.data)?body.data:[];
   all.push(...rows.map(transformFixture).filter(x=>String(x.leagueId)===String(leagueId)));
   const p=body.pagination||{};
   if(p.has_more!==true || rows.length===0)break;
   page=Number(p.current_page||page)+1;
  }
  cursor=new Date(windowEnd.getTime()+86400000);
 }
 const unique=new Map(); for(const x of all)unique.set(String(x.sportmonksId),x);
 return {ok:true,fixtures:[...unique.values()]};
}
async function getLeagueTeamsFromRecentFixtures(leagueId,days=365){
 const end=new Date(),start=new Date(end.getTime()-Math.max(30,days)*86400000),iso=d=>d.toISOString().slice(0,10);
 const r=await getLeagueFixturesBetween(leagueId,iso(start),iso(end));if(!r.ok)return r;
 const teams=new Map();for(const x of r.fixtures||[]){if(x.homeTeamId)teams.set(String(x.homeTeamId),{id:x.homeTeamId,name:x.homeTeam});if(x.awayTeamId)teams.set(String(x.awayTeamId),{id:x.awayTeamId,name:x.awayTeam});}
 return {ok:true,teams:[...teams.values()],fixtures:r.fixtures};
}

function toResultMatches(fixtures) {
  return (fixtures || []).map(f => ({
    fixtureId: String(f.sportmonksId), id: String(f.sportmonksId), sportmonksId: f.sportmonksId,
    leagueId: f.leagueId, league: f.leagueName || null,
    homeTeam: f.homeTeam, awayTeam: f.awayTeam,
    homeTeamId: f.homeTeamId, awayTeamId: f.awayTeamId,
    homeScore: f.homeScore, awayScore: f.awayScore,
    halftimeHome: f.halftimeHome, halftimeAway: f.halftimeAway,
    kickoff: f.kickoff, statusShort: f.statusShort || null,
    minute: f.minute ?? null, isLive: !!f.isLive,
    scoreSource: 'sportmonks', halftimeSource: (f.halftimeHome != null && f.halftimeAway != null) ? 'sportmonks' : null,
    dataSource: 'sportmonks'
  }));
}

module.exports = { toResultMatches, getFixturesByDate, enrichMatches, getLeagueFixturesBetween, getLeagueTeamsFromRecentFixtures, request, getInplay, getLivescores, getFixtureIntelligence, getTeamFixtureHistory, aggregateTeamHistory, transformFixture, findMatch, getVerifiedLiveData };
