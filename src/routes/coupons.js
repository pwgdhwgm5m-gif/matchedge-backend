const express = require('express');
const Coupon = require('../models/Coupon');
const User = require('../models/User');
const CommunityPick = require('../models/CommunityPick');
const { requireAuth } = require('../middleware/authMiddleware');
const sportsDb = require('../services/sportsDbService');
const footballDataOrg = require('../services/footballDataOrgService');
const { ensureWallet, COUPON_STAKE, calculatePayout } = require('../services/gamificationService');

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
  if (key === 'cornersOver85') return corners == null ? 'void' : corners > 8.5 ? 'won' : 'lost';
  if (key === 'cornersUnder85') return corners == null ? 'void' : corners < 8.5 ? 'won' : 'lost';
  if (halftimeHome == null || halftimeAway == null) return 'void';
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
  return 'void';
}

async function settlePending(userId) {
  const coupons = await Coupon.find({ userId, status: 'pending' }).sort({ createdAt: -1 }).limit(30);
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
    coupon.selections.forEach(selection => {
      selection.result = settleSelection(selection.key, match.homeScore, match.awayScore, corners, match.halftimeHome, match.halftimeAway);
    });
    coupon.finalScore = { home: match.homeScore, away: match.awayScore };
    coupon.status = coupon.selections.some(s => s.result === 'lost')
      ? 'lost'
      : coupon.selections.some(s => s.result === 'pending')
        ? 'pending'
        : coupon.selections.some(s => s.result === 'won') ? 'won' : 'void';
    coupon.settledAt = coupon.status === 'pending' ? null : new Date();
    coupon.markModified('selections');
    await coupon.save();

    await Promise.all(coupon.selections.map(selection => CommunityPick.updateOne(
      { userId, fixtureId: coupon.fixtureId, key: selection.key },
      { $set: { result: selection.result, settledAt: coupon.settledAt } }
    )));

    if (coupon.status !== 'pending' && !coupon.rewardedAt) {
      const claimed = await Coupon.findOneAndUpdate(
        { _id: coupon._id, rewardedAt: null },
        { $set: { rewardedAt: new Date() } },
        { new: true }
      );
      if (claimed) {
        const legWins = coupon.selections.filter(s => s.result === 'won').length;
        if (coupon.status === 'won') {
          const payout = coupon.potentialPayout || COUPON_STAKE;
          const xp = 20 + (legWins * 5);
          const updated = await User.findByIdAndUpdate(userId, {
            $inc: { edgeCoins: payout, totalCoinsWon: payout, xp, correctPicks: legWins, currentStreak: 1 }
          }, { new: true });
          if (updated && updated.currentStreak > updated.bestStreak) {
            updated.bestStreak = updated.currentStreak;
            await updated.save();
          }
        } else if (coupon.status === 'lost') {
          await User.findByIdAndUpdate(userId, {
            $inc: { wrongPicks: coupon.selections.filter(s => s.result === 'lost').length },
            $set: { currentStreak: 0 }
          });
        } else {
          await User.findByIdAndUpdate(userId, { $inc: { edgeCoins: coupon.stakeCoins || COUPON_STAKE } });
        }
      }
    }
  }
  return coupons.length;
}

router.get('/', async (req, res) => {
  try {
    await settlePending(req.user.userId);
    const coupons = await Coupon.find({ userId: req.user.userId }).sort({ createdAt: -1 }).limit(100);
    res.json({ coupons });
  } catch (error) {
    console.error('[coupons/get]', error.message);
    res.status(500).json({ error: 'Kuponlar alınamadı.' });
  }
});

router.post('/', async (req, res) => {
  const { fixtureId, homeTeam, awayTeam, league, kickoff, selections } = req.body;
  const safeSelections = Array.isArray(selections)
    ? selections.filter(item => ALLOWED_KEYS.has(item.key)).slice(0, 3).map(item => ({
        key: item.key,
        market: String(item.market || '').slice(0, 30),
        label: String(item.label || '').slice(0, 50),
        probability: Number(item.probability) || null,
      }))
    : [];
  if (!fixtureId || !homeTeam || !awayTeam || !safeSelections.length) return res.status(400).json({ error: 'Maç ve seçim gerekli.' });

  const date = kickoff ? new Date(kickoff) : null;
  if (date && !Number.isNaN(date.getTime()) && date.getTime() <= Date.now()) {
    return res.status(409).json({ error: 'Başlamış maç kupona eklenemez.' });
  }

  try {
    let user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
    if (ensureWallet(user)) await user.save();

    user = await User.findOneAndUpdate(
      { _id: req.user.userId, edgeCoins: { $gte: COUPON_STAKE } },
      { $inc: { edgeCoins: -COUPON_STAKE, totalCoinsSpent: COUPON_STAKE } },
      { new: true }
    );
    if (!user) return res.status(402).json({ error: 'Bu kupon için yeterli Edge Coin yok.' });

    const payout = calculatePayout(safeSelections);
    let coupon;
    try {
      coupon = await Coupon.create({
        userId: req.user.userId, fixtureId, homeTeam, awayTeam, league, kickoff: date,
        matchDate: date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : null,
        selections: safeSelections, stakeCoins: COUPON_STAKE,
        payoutMultiplier: payout.multiplier, potentialPayout: payout.payout,
      });
    } catch (error) {
      await User.findByIdAndUpdate(req.user.userId, {
        $inc: { edgeCoins: COUPON_STAKE, totalCoinsSpent: -COUPON_STAKE }
      });
      throw error;
    }

    await Promise.all(safeSelections.map(selection => CommunityPick.updateOne(
      { userId: req.user.userId, fixtureId: String(fixtureId), key: selection.key },
      { $set: { homeTeam, awayTeam, league: league || '', kickoff: date, market: selection.market, label: selection.label, result: 'pending', settledAt: null } },
      { upsert: true }
    )));
    res.status(201).json({ coupon, balance: user.edgeCoins });
  } catch (error) {
    console.error('[coupons/create]', error.message);
    res.status(500).json({ error: 'Kupon oluşturulamadı.' });
  }
});

router.post('/settle', async (req, res) => {
  try {
    const checked = await settlePending(req.user.userId);
    res.json({ checked });
  } catch (error) {
    console.error('[coupons/settle]', error.message);
    res.status(500).json({ error: 'Sonuçlar kontrol edilemedi.' });
  }
});

router.delete('/:id', async (req, res) => {
  const coupon = await Coupon.findOne({ _id: req.params.id, userId: req.user.userId });
  if (!coupon) return res.status(404).json({ error: 'Kupon bulunamadı.' });
  if (coupon.status === 'pending') return res.status(409).json({ error: 'Bekleyen kupon silinemez.' });
  await coupon.deleteOne();
  res.json({ deleted: true });
});

module.exports = router;
