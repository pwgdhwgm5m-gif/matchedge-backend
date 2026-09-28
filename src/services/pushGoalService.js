const webpush = require('web-push');
const PushSubscription = require('../models/PushSubscription');
const Favorite = require('../models/Favorite');
const Coupon = require('../models/Coupon');
const CommunityPick = require('../models/CommunityPick');
const User = require('../models/User');
const NotificationEvent = require('../models/NotificationEvent');
const ProviderIdentity = require('../models/ProviderIdentity');
const sportsDb = require('./sportsDbService');
const bsd = require('./bsdService');
const sportmonks = require('./sportmonksService');
const cache = require('../utils/cache');
const {createHash}=require('crypto');
const {attachAliases,goalMatchKey,nextGoalScore}=require('./goalNotificationIdentity');
const {hasTrackedSportmonksFixture,sportmonksGoalMatches}=require('./goalPushSourcePolicy');
const {runGoalSources}=require('./goalSourceRunner');

const lastScores = new Map();
// Prevent the same goal event from being pushed again after a process restart,
// overlapping provider snapshots, or a temporary score rollback.
const sentGoalKeys = new Map();
const sentSmartKeys = new Map();
const SENT_GOAL_TTL_MS = 6 * 60 * 60 * 1000;
let running = false;
let lastTrackedLiveAt = 0;

function goalEventKey(fixtureId, home, away) {
  return `${String(fixtureId)}:${Number(home)}-${Number(away)}`;
}

function wasGoalAlreadySent(key) {
  const at = sentGoalKeys.get(key);
  return Number.isFinite(at) && Date.now() - at < SENT_GOAL_TTL_MS;
}

function markGoalSent(key) {
  const now = Date.now();
  sentGoalKeys.set(key, now);
  // Keep the in-memory dedupe cache bounded.
  for (const [k, at] of sentGoalKeys) {
    if (now - at >= SENT_GOAL_TTL_MS) sentGoalKeys.delete(k);
  }
}

function configured() {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

async function sendToUsers(userIds, payload) {
  if (!userIds.length || !configured()) return {subscriptions:0,accepted:0};
  const subs = await PushSubscription.find({ userId: { $in: userIds } }).lean();
  const outcomes=await Promise.allSettled(subs.map(async s => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(payload), { TTL: 120 });
      return true;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) await PushSubscription.deleteOne({ _id: s._id });
      else console.warn('[push/send]', e.statusCode || e.message);
      return false;
    }
  }));
  return {subscriptions:subs.length,accepted:outcomes.filter(x=>x.status==='fulfilled'&&x.value===true).length};
}
async function claimPushEvent(eventId, kind='coupon') {
  try { await NotificationEvent.create({ eventId, kind }); return true; }
  catch (e) { if (e && e.code === 11000) return false; throw e; }
}


async function trackedUsersByFixture() {
  const all = new Map(), coupons = new Map(), matches = [], trackedRows=[];
  const add = (map, fixtureId, userId) => {
    if (!fixtureId || !userId) return;
    const id = String(fixtureId);
    if (!map.has(id)) map.set(id, new Set());
    map.get(id).add(String(userId));
  };
  const addCoupon = (leg, userId) => {
    const ids = [leg.fixtureId, ...Object.values(leg.providerIds || {})].filter(Boolean);
    ids.forEach(id => { add(all, id, userId); add(coupons, id, userId); });
    matches.push({ userId:String(userId), homeTeam:leg.homeTeam, awayTeam:leg.awayTeam, kickoff:leg.kickoff });
    trackedRows.push({userId:String(userId),fixtureId:leg.fixtureId,homeTeam:leg.homeTeam,
      awayTeam:leg.awayTeam,kickoff:leg.kickoff,coupon:true});
  };
  const [favorites, couponRows] = await Promise.all([
    Favorite.find({}).select('userId fixtureId homeTeam awayTeam').lean(),
    Coupon.find({$or:[{status:'pending'},{'legs.selection.result':'pending'},{'selections.result':'pending'}]}).select('userId fixtureId homeTeam awayTeam kickoff legs').lean()
  ]);
  favorites.forEach(x => {add(all, x.fixtureId, x.userId);
    trackedRows.push({userId:String(x.userId),fixtureId:x.fixtureId,homeTeam:x.homeTeam,awayTeam:x.awayTeam,coupon:false});});
  couponRows.forEach(c => {
    if (c.legs && c.legs.length) c.legs.forEach(l => addCoupon(l, c.userId));
    else addCoupon({fixtureId:c.fixtureId, homeTeam:c.homeTeam, awayTeam:c.awayTeam, kickoff:c.kickoff}, c.userId);
  });
  return { all, coupons, matches, trackedRows };
}
async function withProviderAliases(tracked){
  const ids=[...tracked.all.keys()].sort();
  if(!ids.length)return tracked;
  const now=Date.now();
  const q={$gte:new Date(now-4*60*60*1000),$lte:new Date(now+4*60*60*1000)};
  try {
    const key=createHash('sha1').update(ids.join(',')).digest('hex');
    const result=await cache.getOrFetch(`push:provider-aliases:${key}`,30,async()=>({ok:true,
      rows:await ProviderIdentity.find({kickoff:q,$or:['bsd','sportsdb','sportmonks']
        .map(provider=>({[`providerIds.${provider}`]:{$in:ids}}))})
        .select('canonicalKey kickoff home away providerIds').lean()}));
    return attachAliases(tracked,result.rows||[]);
  } catch(e) {
    console.warn('[push/identity]',e.message);
    return {...tracked,identities:[]};
  }
}
function normalizeTeam(v){return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\b(fc|cf|sc|afc|fk|sk|calcio|football|club)\b/g,' ').replace(/[^a-z0-9]+/g,' ').trim()}
function sameTrackedMatch(row, match){
  const h=normalizeTeam(row.homeTeam),a=normalizeTeam(row.awayTeam),mh=normalizeTeam(match.homeTeam),ma=normalizeTeam(match.awayTeam);
  const ka=new Date(row.kickoff||0).getTime(),kb=new Date(match.kickoff||0).getTime();
  return !!h&&!!a&&!!mh&&!!ma&&(mh===h||mh.includes(h)||h.includes(mh))&&(ma===a||ma.includes(a)||a.includes(ma))&&Number.isFinite(ka)&&Number.isFinite(kb)&&Math.abs(ka-kb)<=15*60*1000;
}
function usersForTrackedMatch(tracked, match, fixtureId, couponsOnly=false){
  const users=new Set((couponsOnly?tracked.coupons:tracked.all).get(String(fixtureId))||[]);
  if(couponsOnly){for(const row of tracked.matches)if(sameTrackedMatch(row,match))users.add(row.userId)}
  else for(const row of tracked.matches)if(sameTrackedMatch(row,match))users.add(row.userId);
  return users;
}


async function checkGoals() {
  if (running || !configured()) return;
  running = true;
  const cycleStarted=Date.now();
  try {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:support@socceredgepro.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
    const tracked = await withProviderAliases(await trackedUsersByFixture());
    if (!tracked.all.size) return;
    // Refresh more often around a tracked kickoff and while a tracked match
    // is live. The shared BSD request budget still limits all requests.
    const now=Date.now();
    const nearKickoff=tracked.trackedRows.some(row=>{
      const kickoff=Date.parse(row.kickoff||'');
      return Number.isFinite(kickoff) && kickoff>=now-3*60*60*1000 && kickoff<=now+10*60*1000;
    }) || tracked.identities.some(row=>{
      const kickoff=Date.parse(row.kickoff||'');
      return Number.isFinite(kickoff) && kickoff>=now-3*60*60*1000 && kickoff<=now+10*60*1000;
    });
    const bsdTtl=nearKickoff || now-lastTrackedLiveAt<3*60*1000 ? 10 : 30;
    // Query the subscribed six leagues by their native SportMonks fixture IDs.
    // Do not spend SportMonks calls for unrelated leagues or stale favorites.
    const checkSportmonks=hasTrackedSportmonksFixture(tracked.identities);
    // Process each provider as soon as it responds. Waiting for all providers
    // made a fast score wait behind a slow (or timed-out) fallback request.
    const processMatches = async (matches, sourceInfo={}) => {
    for (const m of matches) {
      const id = String(m.fixtureId);
      const matchKey=goalMatchKey(tracked.identities,m);
      const couponUsers = usersForTrackedMatch(tracked, m, id, true);
      const matchUsers = usersForTrackedMatch(tracked, m, id, false);
      if (!matchUsers.size) continue;
      const trackedRow = tracked.matches.find(row => sameTrackedMatch(row, m));
      const homeTeam = String(m.homeTeam || trackedRow?.homeTeam || 'Maç');
      const awayTeam = String(m.awayTeam || trackedRow?.awayTeam || '');
      if(m.homeScore==null || m.awayScore==null ||
          !Number.isFinite(Number(m.homeScore)) || !Number.isFinite(Number(m.awayScore)))continue;
      const home = Number(m.homeScore), away = Number(m.awayScore);
      const old = lastScores.get(matchKey);
      const isLive = m.isLive === true || ['LIVE','1H','2H','HT'].includes(String(m.statusShort || '').toUpperCase());
      if(isLive)lastTrackedLiveAt=Date.now();
      const observation=nextGoalScore(old,home,away,isLive);
      lastScores.set(matchKey,observation.score);
      if (isLive && couponUsers.size && !old?.started) {
        const eventId = 'coupon-start:' + matchKey;
        if (await claimPushEvent(eventId, 'coupon-start')) await sendToUsers([...couponUsers], {
          type:'match-start', eventId, fixtureId:id, title:'⚽ Maç başladı', body:homeTeam+' – '+awayTeam+' başladı.',
          homeTeam, awayTeam, url:'/canli-simulator.html?fixtureId='+encodeURIComponent(id)
        });
      }
      if (!observation.advanced) continue;
      const eventKey = goalEventKey(matchKey, home, away);
      if (wasGoalAlreadySent(eventKey)) continue;
      if (await claimPushEvent(eventKey, 'goal')) {
        markGoalSent(eventKey);
        const pushStarted=Date.now();
        const delivery=await sendToUsers([...matchUsers], {
        type:'goal', eventId:eventKey, fixtureId:id, title:'⚽ GOL!', body:homeTeam+' '+home+' – '+away+' '+awayTeam,
        homeTeam:m.homeTeam, awayTeam:m.awayTeam, homeScore:home, awayScore:away, url:'/canli-simulator.html?fixtureId='+encodeURIComponent(id)
        });
        console.log('[push/goal-latency]',JSON.stringify({provider:m.source||'unknown',
          fetchMs:sourceInfo.fetchMs,pushAckMs:Date.now()-pushStarted,cycleMs:Date.now()-cycleStarted,
          cached:sourceInfo.cached===true,sourceAgeMs:sourceInfo.fetchedAt?Date.now()-sourceInfo.fetchedAt:null,
          subscriptions:delivery.subscriptions,accepted:delivery.accepted}));
      } else markGoalSent(eventKey);
    }
    };
    // Canonical goal-source policy: subscribed six leagues prefer SportMonks,
    // all other matches prefer BSD; SportsDB is fallback only. We still start
    // the two primary feeds together because one BSD day/live snapshot covers
    // every non-core tracked match. SportsDB is queried only when neither
    // primary source produced a usable tracked live observation this cycle.
    let primaryUsable=false;
    const markPrimary=transform=>result=>{
      const matches=transform(result);
      if(matches.some(m=>usersForTrackedMatch(tracked,m,String(m.fixtureId),false).size &&
          m.homeScore!=null && m.awayScore!=null)) primaryUsable=true;
      return matches;
    };
    const primarySources=[
      ...(checkSportmonks ? [{fetch:()=>cache.getOrFetch('push:sportmonks:inplay',5,()=>sportmonks.getInplay(4000)),
        transform:markPrimary(result=>sportmonksGoalMatches(result.fixtures))}] : []),
      {fetch:()=>bsd.getLiveFootballEvents(Math.min(bsdTtl,5)),
        transform:markPrimary(result=>bsd.extractList(result.data).map(bsd.eventToResultMatch).filter(Boolean))}
    ];
    const outcomes=await runGoalSources(primarySources,processMatches);
    if(!primaryUsable){
      const fallback=await runGoalSources([
        {fetch:()=>sportsDb.getLiveScores(),transform:result=>(result.data?.livescore||[])
          .filter(e=>String(e.strSport||'').toLowerCase()==='soccer')
          .map(e=>({...sportsDb.transformLiveEvent(e),source:'sportsdb'}))}
      ],processMatches);
      outcomes.push(...fallback);
    }
    for(const outcome of outcomes)if(outcome.status==='rejected')console.warn('[push/source]',outcome.reason?.message||outcome.reason);
  } catch (e) { console.warn('[push/goals]', e.message); }
  finally { running = false; }
}

async function notifyCouponSettlement(userId, coupon) {
  if (!configured() || !coupon || !userId || coupon.status === 'pending') return false;
  const legs = coupon.legs?.length ? coupon.legs : (coupon.selections || []).map(s => ({ homeTeam:coupon.homeTeam, awayTeam:coupon.awayTeam, selection:s }));
  if (legs.some(l => (l.selection?.result || l.result) === 'pending')) return false;
  const result = coupon.status === 'won' ? 'kazandı' : coupon.status === 'void' ? 'iade edildi' : 'kaybetti';
  const title = coupon.status === 'won' ? '✅ Kupon tuttu' : coupon.status === 'void' ? '↩ Kupon iade edildi' : '❌ Kupon sonucu';
  const body = (legs[0]?.homeTeam || coupon.homeTeam || 'Maç') + (legs.length > 1 ? ' ve diğer maçlar' : '') + ' · Kupon ' + result + '.';
  const eventId = 'coupon-settled:' + String(coupon._id) + ':' + String(coupon.status);
  if (!await claimPushEvent(eventId, 'coupon-settled')) return false;
  await sendToUsers([String(userId)], { type:'coupon-settled', eventId, fixtureId:String(legs[0]?.fixtureId || coupon.fixtureId || ''), title, body, url:'/kuponum.html' });
  return true;
}

async function claimSmartEvent(eventId){try{await NotificationEvent.create({eventId,kind:'smart'});return true}catch(e){if(e&&e.code===11000)return false;throw e}}
async function checkSmartNotifications(){
 if(!configured())return;
 const since=new Date(Date.now()-12*60*1000);
 const picks=await CommunityPick.find({verified:true,$or:[{createdAt:{$gte:since}},{settledAt:{$gte:since}}]}).lean();
 for(const p of picks){
  const analyst=await User.findById(p.userId).select('username followers').lean();if(!analyst)continue;
  if(p.createdAt>=since){const k='vp:new:'+p._id;if(!sentSmartKeys.has(k)&&await claimSmartEvent(k)){sentSmartKeys.set(k,Date.now());await sendToUsers((analyst.followers||[]).map(String),{type:'verified-pick',eventId:k,title:'✓ New Verified Pick',body:'@'+analyst.username+' · '+p.homeTeam+' – '+p.awayTeam+' · '+p.label,url:'/match-room.html?fixtureId='+encodeURIComponent(p.fixtureId)+'&home='+encodeURIComponent(p.homeTeam)+'&away='+encodeURIComponent(p.awayTeam)+'&league='+encodeURIComponent(p.league||'')})}}
  if(p.settledAt&&p.settledAt>=since){const k='vp:settled:'+p._id+':'+p.result;if(!sentSmartKeys.has(k)){sentSmartKeys.set(k,Date.now());await sendToUsers((analyst.followers||[]).map(String),{type:'verified-result',eventId:k,title:'Verified Pick · '+String(p.result).toUpperCase(),body:'@'+analyst.username+' · '+p.homeTeam+' – '+p.awayTeam+' · '+p.label,url:'/social-profile.html?u='+encodeURIComponent(analyst.username)})}}
 }
 const now=Date.now();for(const [k,t] of sentSmartKeys)if(now-t>24*60*60*1000)sentSmartKeys.delete(k);
}
function startPushGoalMonitor() {
  if (!configured()) { console.log('[push] VAPID not configured'); return; }
  setTimeout(checkGoals, 3000);
  setInterval(checkGoals, 5000);
  setTimeout(checkSmartNotifications, 8000);
  setInterval(checkSmartNotifications, 5 * 60 * 1000);
}

module.exports = { startPushGoalMonitor, sendToUsers, checkSmartNotifications, notifyCouponSettlement };
