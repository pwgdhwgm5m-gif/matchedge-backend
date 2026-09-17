const express = require('express');
const Coupon = require('../models/Coupon');
const CommunityPick = require('../models/CommunityPick');
const User = require('../models/User');
const { requireAuth } = require('../middleware/authMiddleware');
const sportsDb = require('../services/sportsDbService');
const footballDataOrg = require('../services/footballDataOrgService');

const router = express.Router();
router.use(requireAuth);

const ALLOWED_KEYS = new Set(['home', 'draw', 'away', 'over25', 'under25', 'bttsYes', 'bttsNo', 'cornersOver85', 'cornersUnder85', 'fhHome', 'fhDraw', 'fhAway', 'shHome', 'shDraw', 'shAway', 'mostGoalsFirst', 'mostGoalsEqual', 'mostGoalsSecond']);

function settleSelection(key, home, away, corners, halftimeHome, halftimeAway) {
  const total = home + away;
  if (key === 'home') return home > away ? 'won' : 'lost';
  if (key === 'draw') return home === away ? 'won' : 'lost';
  if (key === 'away') return away > home ? 'won' : 'lost';
  if (key === 'over25') return total > 2.5 ? 'won' : 'lost';
  if (key === 'under25') return total < 2.5 ? 'won' : 'lost';
  if (key === 'bttsYes') return home > 0 && away > 0 ? 'won' : 'lost';
  if (key === 'bttsNo') return home === 0 || away === 0 ? 'won' : 'lost';
  if (key === 'cornersOver85' && corners != null) return corners > 8.5 ? 'won' : 'lost';
  if (key === 'cornersUnder85' && corners != null) return corners < 8.5 ? 'won' : 'lost';
  if (halftimeHome == null || halftimeAway == null) return 'pending';
  const secondHome = home - halftimeHome;
  const secondAway = away - halftimeAway;
  if (key === 'fhHome') return halftimeHome > halftimeAway ? 'won' : 'lost';
  if (key === 'fhDraw') return halftimeHome === halftimeAway ? 'won' : 'lost';
  if (key === 'fhAway') return halftimeAway > halftimeHome ? 'won' : 'lost';
  if (key === 'shHome') return secondHome > secondAway ? 'won' : 'lost';
  if (key === 'shDraw') return secondHome === secondAway ? 'won' : 'lost';
  if (key === 'shAway') return secondAway > secondHome ? 'won' : 'lost';
  const firstGoals = halftimeHome + halftimeAway;
  const secondGoals = secondHome + secondAway;
  if (key === 'mostGoalsFirst') return firstGoals > secondGoals ? 'won' : 'lost';
  if (key === 'mostGoalsEqual') return firstGoals === secondGoals ? 'won' : 'lost';
  if (key === 'mostGoalsSecond') return secondGoals > firstGoals ? 'won' : 'lost';
  return 'pending';
}

router.get('/', async (req, res) => {
  try {
    const coupons = await Coupon.find({ userId: req.user.userId }).sort({ createdAt: -1 }).limit(100);
    res.json({ coupons });
  } catch (error) {
    res.status(500).json({ error: 'Kuponlar alınamadı.' });
  }
});

router.post('/', async (req, res) => {
  const { fixtureId, homeTeam, awayTeam, league, kickoff, selections } = req.body;
  const safeSelections = Array.isArray(selections)
    ? selections.filter(item => ALLOWED_KEYS.has(item.key)).slice(0, 9).map(item => ({
        key: item.key, market: String(item.market || '').slice(0, 30),
        label: String(item.label || '').slice(0, 50), probability: Number(item.probability) || null,
      }))
    : [];
  if (!fixtureId || !homeTeam || !awayTeam || !safeSelections.length) return res.status(400).json({ error: 'Maç ve seçim gerekli.' });
  try {
    const date = kickoff ? new Date(kickoff) : null;
    const coupon = await Coupon.create({
      userId: req.user.userId, fixtureId, homeTeam, awayTeam, league, kickoff: date,
      matchDate: date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : null,
      selections: safeSelections,
    });
    await Promise.all(safeSelections.map(selection => CommunityPick.findOneAndUpdate(
      { userId: req.user.userId, fixtureId: String(fixtureId), key: selection.key },
      { userId: req.user.userId, fixtureId: String(fixtureId), homeTeam, awayTeam, league: league || '', kickoff: date, key: selection.key, market: selection.market, label: selection.label },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    )));
    res.status(201).json({ coupon });
  } catch (error) {
    res.status(500).json({ error: 'Kupon oluşturulamadı.' });
  }
});

router.post('/settle', async (req, res) => {
  try {
    const coupons = await Coupon.find({ userId: req.user.userId, status: 'pending' }).sort({ createdAt: -1 }).limit(30);
    const dates = [...new Set(coupons.map(c => c.matchDate).filter(Boolean))];
    const matchesByDate = new Map();
    for (const date of dates) {
      const [raw, verified] = await Promise.all([sportsDb.getMatchesByDate(date), footballDataOrg.getMatchesByDate(date)]);
      let matches = raw.ok ? (raw.data?.events || []).map(sportsDb.transformEvent) : [];
      if (verified.ok) matches = footballDataOrg.mergeVerifiedScores(matches, verified.matches);
      matches = await sportsDb.attachHalftimeScores(matches);
      matchesByDate.set(date, matches);
    }
    for (const coupon of coupons) {
      const match = (matchesByDate.get(coupon.matchDate) || []).find(m => String(m.fixtureId) === String(coupon.fixtureId));
      if (!match || match.statusShort !== 'FT') continue;
      let corners = null;
      if (coupon.selections.some(s => s.key.startsWith('corners'))) {
        const stats = await sportsDb.getEventStatsFormatted(coupon.fixtureId);
        if (stats.available && stats.stats?.corners) corners = Number(stats.stats.corners.home || 0) + Number(stats.stats.corners.away || 0);
      }
      coupon.selections.forEach(selection => { selection.result = settleSelection(selection.key, match.homeScore, match.awayScore, corners, match.halftimeHome, match.halftimeAway); });
      coupon.finalScore = { home: match.homeScore, away: match.awayScore };
      coupon.status = coupon.selections.some(s => s.result === 'lost') ? 'lost' : coupon.selections.every(s => s.result === 'won') ? 'won' : 'pending';
      coupon.settledAt = coupon.status === 'pending' ? null : new Date();
      coupon.markModified('selections');

      if (coupon.status !== 'pending' && !coupon.rewardsProcessed) {
        const won = coupon.selections.filter(s => s.result === 'won').length;
        const lost = coupon.selections.filter(s => s.result === 'lost').length;
        const xp = won * 10 + lost * 2;
        const coins = won * 10 + (coupon.status === 'won' && coupon.selections.length > 1 ? 5 * coupon.selections.length : 0);
        const user = await User.findById(coupon.userId);
        if (user) {
          user.xp = (user.xp || 0) + xp;
          user.edgeCoins = (user.edgeCoins || 0) + coins;
          user.correctPicks = (user.correctPicks || 0) + won;
          user.wrongPicks = (user.wrongPicks || 0) + lost;
          user.currentStreak = lost ? 0 : (user.currentStreak || 0) + won;
          user.bestStreak = Math.max(user.bestStreak || 0, user.currentStreak || 0);
          await user.save();
        }
        coupon.rewardsProcessed = true;
        coupon.xpAwarded = xp;
        coupon.coinsAwarded = coins;
      }
      await CommunityPick.updateMany(
        { userId: coupon.userId, fixtureId: coupon.fixtureId, key: { $in: coupon.selections.map(s => s.key) } },
        [{ $set: { result: { $let: { vars: { found: { $arrayElemAt: [{ $filter: { input: coupon.selections.map(s => ({ key: s.key, result: s.result })), as: 's', cond: { $eq: ['$s.key', '$key'] } } }, 0] } }, in: '$found.result' } }, settledAt: new Date() } }]
      ).catch(() => {});
      await coupon.save();
    }
    res.json({ checked: coupons.length });
  } catch (error) {
    console.error('[coupons/settle]', error.message);
    res.status(500).json({ error: 'Sonuçlar kontrol edilemedi.' });
  }
});

router.delete('/:id', async (req, res) => {
  const result = await Coupon.deleteOne({ _id: req.params.id, userId: req.user.userId });
  if (!result.deletedCount) return res.status(404).json({ error: 'Kupon bulunamadı.' });
  res.json({ deleted: true });
});

module.exports = router;
