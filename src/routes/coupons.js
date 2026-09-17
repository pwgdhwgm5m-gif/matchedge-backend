const express = require('express');
const Coupon = require('../models/Coupon');
const { requireAuth } = require('../middleware/authMiddleware');
const sportsDb = require('../services/sportsDbService');
const footballDataOrg = require('../services/footballDataOrgService');

const router = express.Router();
router.use(requireAuth);

const ALLOWED_KEYS = new Set(['home', 'draw', 'away', 'over25', 'under25', 'bttsYes', 'bttsNo', 'cornersOver85', 'cornersUnder85']);

function settleSelection(key, home, away, corners) {
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
      coupon.selections.forEach(selection => { selection.result = settleSelection(selection.key, match.homeScore, match.awayScore, corners); });
      coupon.finalScore = { home: match.homeScore, away: match.awayScore };
      coupon.status = coupon.selections.some(s => s.result === 'lost') ? 'lost' : coupon.selections.every(s => s.result === 'won') ? 'won' : 'pending';
      coupon.settledAt = coupon.status === 'pending' ? null : new Date();
      coupon.markModified('selections');
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
