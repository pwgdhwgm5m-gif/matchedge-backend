const axios = require('axios');
const config = require('../config/config');
const { teamNamesMatch } = require('../utils/textNormalize');

const memory = new Map();
const TTL_MS = 10 * 60 * 1000;

function enabled() { return Boolean(config.fiveDollarFootball?.key); }
function headers() { return { Authorization: `Bearer ${config.fiveDollarFootball.key}` }; }
function pickPrice(block) {
  if (!block) return null;
  return block.closing || block.opening || null;
}
function normalizeFixture(f, homeName, awayName) {
  if (!f || !teamNamesMatch(f.teams?.home?.name, homeName) || !teamNamesMatch(f.teams?.away?.name, awayName)) return null;
  const odds = f.odds || {};
  const h2h = pickPrice(odds['1x2']);
  const goals = pickPrice(odds.goal_line || odds.goalline);
  const btts = pickPrice(odds.btts);
  const matchOdds = h2h && Number(h2h.home)>1 && Number(h2h.draw)>1 && Number(h2h.away)>1
    ? { home:Number(h2h.home), draw:Number(h2h.draw), away:Number(h2h.away) } : null;
  const marketBoard = {
    bookmakers: [{ bookmaker:'Bet 365', h2h:matchOdds, totals:goals && Number(goals.line)===2.5 ? {over25:Number(goals.over)||null,under25:Number(goals.under)||null}:null, btts:btts ? {yes:Number(btts.yes)||null,no:Number(btts.no)||null}:null, fresh:true }],
    bookmakerCount: 1,
    best: matchOdds ? {home:{bookmaker:'Bet 365',price:matchOdds.home},draw:{bookmaker:'Bet 365',price:matchOdds.draw},away:{bookmaker:'Bet 365',price:matchOdds.away}} : {},
    btts: btts || null,
  };
  return { fixtureId:f.id, matchOdds, marketBoard, rawOdds:odds, source:'5dollarfootball-bet365' };
}

async function getMatchOdds(homeName, awayName, kickoff) {
  if (!enabled() || !homeName || !awayName || !kickoff) return null;
  const d = new Date(kickoff);
  if (Number.isNaN(d.getTime())) return null;
  const start = Math.floor(new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate())).getTime()/1000);
  const key = `five-dollar-day:${start}`;
  let rows = memory.get(key);
  if (!rows || rows.expires < Date.now()) {
    try {
      const response = await axios.get(`${config.fiveDollarFootball.baseUrl}/fixtures`, {
        headers: headers(),
        params: { start_time:start, end_time:start+86400 },
        timeout: 3500,
      });
      rows = { data:Array.isArray(response.data?.data)?response.data.data:[], expires:Date.now()+TTL_MS };
      memory.set(key, rows);
    } catch (e) {
      const status=e.response?.status;
      if (status===429) console.warn('[5dollar] rate limit reached; fallback skipped');
      else if (status===401||status===403) console.warn('[5dollar] auth/plan unavailable; fallback skipped');
      else console.warn('[5dollar] request failed; fallback skipped');
      return null;
    }
  }
  const fixture = rows.data.find(f => teamNamesMatch(f.teams?.home?.name,homeName) && teamNamesMatch(f.teams?.away?.name,awayName));
  if (!fixture?.id) return null;
  const oddsKey = `five-dollar-odds:${fixture.id}`;
  let oddsRow = memory.get(oddsKey);
  if (!oddsRow || oddsRow.expires < Date.now()) {
    try {
      const response = await axios.get(`${config.fiveDollarFootball.baseUrl}/fixtures/${fixture.id}/odds`, {
        headers: headers(), params: { bookmakers:'bet365' }, timeout: 3500,
      });
      oddsRow = { data:response.data?.data || null, expires:Date.now()+TTL_MS };
      memory.set(oddsKey, oddsRow);
    } catch (e) {
      const status=e.response?.status;
      if (status===429) console.warn('[5dollar] rate limit reached; odds fallback skipped');
      else if (status===401||status===403) console.warn('[5dollar] auth/plan unavailable; odds fallback skipped');
      else console.warn('[5dollar] odds request failed; fallback skipped');
      return null;
    }
  }
  const bet365 = oddsRow.data?.bookmakers?.find(b => String(b.slug||'').toLowerCase()==='bet365') || oddsRow.data?.bookmakers?.[0];
  return normalizeFixture({...fixture, odds:bet365?.odds || {}},homeName,awayName);
}

module.exports = { enabled, getMatchOdds };
