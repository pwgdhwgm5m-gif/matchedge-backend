const webpush = require('web-push');
const PushSubscription = require('../models/PushSubscription');
const Favorite = require('../models/Favorite');
const Coupon = require('../models/Coupon');
const CommunityPick = require('../models/CommunityPick');
const User = require('../models/User');
const sportsDb = require('./sportsDbService');

const lastScores = new Map();
// Prevent the same goal event from being pushed again after a process restart,
// overlapping provider snapshots, or a temporary score rollback.
const sentGoalKeys = new Map();
const sentSmartKeys = new Map();
const SENT_GOAL_TTL_MS = 6 * 60 * 60 * 1000;
let running = false;

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
  if (!userIds.length || !configured()) return;
  const subs = await PushSubscription.find({ userId: { $in: userIds } }).lean();
  await Promise.allSettled(subs.map(async s => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(payload), { TTL: 120 });
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) await PushSubscription.deleteOne({ _id: s._id });
      else console.warn('[push/send]', e.statusCode || e.message);
    }
  }));
}

async function trackedUsersByFixture() {
  const map = new Map();
  const add = (fixtureId, userId) => {
    if (!fixtureId || !userId) return;
    const id = String(fixtureId);
    if (!map.has(id)) map.set(id, new Set());
    map.get(id).add(String(userId));
  };
  const [favorites, coupons] = await Promise.all([
    Favorite.find({}).select('userId fixtureId').lean(),
    Coupon.find({ status: 'pending' }).select('userId fixtureId legs').lean()
  ]);
  favorites.forEach(x => add(x.fixtureId, x.userId));
  coupons.forEach(c => {
    if (c.legs && c.legs.length) c.legs.forEach(l => add(l.fixtureId, c.userId));
    else add(c.fixtureId, c.userId);
  });
  return map;
}

async function checkGoals() {
  if (running || !configured()) return;
  running = true;
  try {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:support@socceredgepro.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
    const tracked = await trackedUsersByFixture();
    if (!tracked.size) return;
    const result = await sportsDb.getLiveScores();
    if (!result.ok) return;
    const matches = (result.data?.livescore || []).filter(e => String(e.strSport || '').toLowerCase() === 'soccer').map(sportsDb.transformLiveEvent);
    for (const m of matches) {
      const id = String(m.fixtureId);
      if (!tracked.has(id)) continue;
      const home = Number(m.homeScore || 0), away = Number(m.awayScore || 0), total = home + away;
      const old = lastScores.get(id);
      lastScores.set(id, { home, away, total });
      if (!old || total <= old.total) continue;
      const eventKey = goalEventKey(id, home, away);
      if (wasGoalAlreadySent(eventKey)) continue;
      // Mark before sending so concurrent/overlapping checks cannot enqueue
      // the same score notification twice.
      markGoalSent(eventKey);
      await sendToUsers([...tracked.get(id)], {
        type: 'goal', eventId: eventKey, fixtureId: id, title: '⚽ GOAL!', homeTeam: m.homeTeam, awayTeam: m.awayTeam,
        homeScore: home, awayScore: away, url: '/canli-simulator.html?fixtureId=' + encodeURIComponent(id)
      });
    }
  } catch (e) {
    console.warn('[push/goals]', e.message);
  } finally { running = false; }
}

async function checkSmartNotifications(){
 if(!configured())return;
 const since=new Date(Date.now()-12*60*1000);
 const picks=await CommunityPick.find({verified:true,$or:[{createdAt:{$gte:since}},{settledAt:{$gte:since}}]}).lean();
 for(const p of picks){
  const analyst=await User.findById(p.userId).select('username followers').lean();if(!analyst)continue;
  if(p.createdAt>=since){const k='vp:new:'+p._id;if(!sentSmartKeys.has(k)){sentSmartKeys.set(k,Date.now());await sendToUsers((analyst.followers||[]).map(String),{type:'verified-pick',eventId:k,title:'✓ New Verified Pick',body:'@'+analyst.username+' · '+p.homeTeam+' – '+p.awayTeam+' · '+p.label,url:'/match-room.html?fixtureId='+encodeURIComponent(p.fixtureId)+'&home='+encodeURIComponent(p.homeTeam)+'&away='+encodeURIComponent(p.awayTeam)+'&league='+encodeURIComponent(p.league||'')})}}
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

module.exports = { startPushGoalMonitor, sendToUsers, checkSmartNotifications };
