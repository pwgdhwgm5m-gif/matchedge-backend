const webpush = require('web-push');
const PushSubscription = require('../models/PushSubscription');
const Favorite = require('../models/Favorite');
const Coupon = require('../models/Coupon');
const sportsDb = require('./sportsDbService');

const lastScores = new Map();
let running = false;

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
      await sendToUsers([...tracked.get(id)], {
        type: 'goal', fixtureId: id, title: '⚽ GOAL!', homeTeam: m.homeTeam, awayTeam: m.awayTeam,
        homeScore: home, awayScore: away, url: '/canli-simulator.html?fixtureId=' + encodeURIComponent(id)
      });
    }
  } catch (e) {
    console.warn('[push/goals]', e.message);
  } finally { running = false; }
}

function startPushGoalMonitor() {
  if (!configured()) { console.log('[push] VAPID not configured'); return; }
  setTimeout(checkGoals, 3000);
  setInterval(checkGoals, 5000);
}

module.exports = { startPushGoalMonitor };
