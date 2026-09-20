const express = require('express');
const User = require('../models/User');
const LoginEvent = require('../models/LoginEvent');
const ledger = require('../services/predictionLedgerService');
const ModelCalibration = require('../models/ModelCalibration');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireAdmin } = require('../middleware/adminMiddleware');

const router = express.Router();

router.use(requireAuth, requireAdmin);

router.get('/users', async (req, res) => {
  try {
    const users = await User.find({})
      .select('username email emailVerified role createdAt lastLoginAt lastActiveAt loginCount')
      .sort({ createdAt: -1 })
      .lean();
    const recentLogins = await LoginEvent.find({})
      .select('userId loginAt country city district countryCode timezone userAgent')
      .populate('userId', 'username email')
      .sort({ loginAt: -1 })
      .limit(200)
      .lean();

    res.json({
      total: users.length,
      verified: users.filter(user => user.emailVerified).length,
      admins: users.filter(user => user.role === 'admin').length,
      users,
      recentLogins,
    });
  } catch (error) {
    console.error('[admin/users] Hata:', error.message);
    res.status(500).json({ error: 'Kullanici listesi alinamadi.' });
  }
});

router.get('/model-performance', async (req, res) => {
  try { res.json(await ledger.performance()); }
  catch (error) { console.error('[model-performance]', error); res.status(500).json({ error: 'Model karnesi alınamadı.' }); }
});

router.get('/sportmonks-backtest', async (req, res) => {
  try { res.json(await ledger.sportmonksBacktest()); }
  catch (error) { console.error('[sportmonks-backtest]', error); res.status(500).json({ error: 'SportMonks backtest alınamadı.' }); }
});

router.get('/walk-forward-audit', async (req, res) => {
  try { res.json(await ledger.walkForwardAudit()); }
  catch (error) { console.error('[walk-forward-audit]', error); res.status(500).json({ error: 'Walk-forward audit alınamadı.' }); }
});

router.post('/power-rating-backfill', async (req,res)=>{
  try{
    const {league,teamId,days}=req.body||{}; if(!teamId)return res.status(400).json({error:'teamId gerekli'});
    const powerRating=require('../services/powerRatingService');
    res.json(await powerRating.backfillFromSportmonks({league,teamId,days:Math.min(730,Math.max(60,Number(days)||365))}));
  }catch(error){console.error('[power-rating-backfill]',error);res.status(500).json({error:'Power rating backfill başarısız'});}
});

router.post('/power-rating-backfill-league', async (req,res)=>{
 try{
  const {leagueId,leagueName,days}=req.body||{};if(!leagueId)return res.status(400).json({error:'leagueId gerekli'});
  const powerRating=require('../services/powerRatingService');
  res.json(await powerRating.backfillLeagueFromSportmonks({leagueId,leagueName,days:Math.min(730,Math.max(60,Number(days)||365))}));
 }catch(error){console.error('[power-rating-backfill-league]',error);res.status(500).json({error:'League power rating backfill başarısız'});}
});

router.post('/power-rating-seed-ledger', async (req,res)=>{
 try{
  const {leagueId,leagueName,days}=req.body||{};
  if(!leagueId||!leagueName)return res.status(400).json({error:'leagueId ve leagueName gerekli'});
  const powerRating=require('../services/powerRatingService');
  res.json(await powerRating.seedLeagueEventsFromSportmonks({leagueId,leagueName,days:Math.min(730,Math.max(60,Number(days)||365))}));
 }catch(error){console.error('[power-rating-seed-ledger]',error);res.status(500).json({error:'Power rating ledger seed başarısız'});}
});

router.get('/model-calibration', async (req, res) => {
  try {
    const rows = await ModelCalibration.find({}).sort({active:-1,trainedAt:-1}).limit(60).lean();
    res.json({rows:rows.map(row => ({ league:row.league, market:row.market, active:row.active,
      offset:row.logitOffset, trainCount:row.trainCount, validationCount:row.validationCount,
      baselineBrier:row.baselineBrier, adjustedBrier:row.adjustedBrier, trainedAt:row.trainedAt }))});
  } catch (error) { res.status(500).json({error:'Kalibrasyon verisi alınamadı.'}); }
});
module.exports = router;
