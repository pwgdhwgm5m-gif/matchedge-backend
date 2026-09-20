const express = require('express');
const User = require('../models/User');
const LoginEvent = require('../models/LoginEvent');
const ledger = require('../services/predictionLedgerService');
const premiumLab = require('../services/premiumLabService');
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

    const latestLoginByUser = new Map();
    for (const event of recentLogins) {
      const id = event.userId?._id ? String(event.userId._id) : String(event.userId || '');
      if (id && !latestLoginByUser.has(id)) latestLoginByUser.set(id, event);
    }
    const usersWithLocation = users.map(user => {
      const event = latestLoginByUser.get(String(user._id));
      return {
        ...user,
        lastApproxLocation: event ? {
          country: event.country || '', city: event.city || '', district: event.district || '',
          timezone: event.timezone || '', loginAt: event.loginAt || null
        } : null
      };
    });
    res.json({
      total: users.length,
      verified: users.filter(user => user.emailVerified).length,
      admins: users.filter(user => user.role === 'admin').length,
      users: usersWithLocation,
      recentLogins,
    });
  } catch (error) {
    console.error('[admin/users] Hata:', error.message);
    res.status(500).json({ error: 'Kullanici listesi alinamadi.' });
  }
});

router.get('/premium-lab', async (req, res) => {
  try {
    const performance = await ledger.performance();
    res.json({
      access: 'admin-only',
      public: false,
      features: {
        aiCouponBuilder: { status: 'staged', source: 'strongest-pick + market-board + risk/diversification' },
        matchSimulation: { status: 'staged', source: 'poisson/dixon-coles model' },
        valueFinder: { status: 'core-ready', source: 'model vs market implied probability' },
        similarMatches: { status: 'staged', source: 'historical feature matching' },
        patternFinder: { status: 'staged', source: 'comparable-match outcomes' },
        verifiedPerformance: { status: 'live-ledger', strongestPick: performance.strongestPick || null }
      }
    });
  } catch (error) {
    console.error('[premium-lab]', error);
    res.status(500).json({ error: 'Premium Lab durumu alınamadı.' });
  }
});

router.post('/premium-lab/coupon-builder', async (req,res)=>{try{res.json(await premiumLab.buildCoupon(req.body||{}))}catch(error){console.error('[premium-lab/coupon]',error);res.status(500).json({error:'Premium kupon oluşturulamadı.'})}});
router.get('/premium-lab/simulate/:fixtureId', async (req,res)=>{try{res.json(await premiumLab.simulateFixture(req.params.fixtureId))}catch(error){res.status(error.status||500).json({error:error.message||'Simülasyon oluşturulamadı.'})}});
router.get('/premium-lab/patterns', async (req,res)=>{try{res.json(await premiumLab.patternFinder(req.query||{}))}catch(error){res.status(500).json({error:error.message||'Pattern analizi oluşturulamadı.'})}});
router.get('/premium-lab/similar/:fixtureId', async (req,res)=>{try{res.json(await premiumLab.similarMatches(req.params.fixtureId,{limit:req.query.limit}))}catch(error){res.status(error.status||500).json({error:error.message||'Benzer maçlar oluşturulamadı.'})}});
router.get('/premium-lab/fixtures', async (req,res)=>{try{const rows=await premiumLab.available(80);res.json({matches:rows.map(x=>({fixtureId:x.fixtureId,kickoff:x.kickoff,league:x.league,homeTeam:x.homeTeam,awayTeam:x.awayTeam,strongestPick:x.strongestPick}))})}catch(error){res.status(500).json({error:'Premium maç listesi alınamadı.'})}});

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

router.get('/paired-model-audit', async (req, res) => {
  try { res.json(await ledger.pairedAudit()); }
  catch (error) { console.error('[paired-model-audit]', error); res.status(500).json({ error: 'Paired model audit alınamadı.' }); }
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

router.post('/power-rating-rebuild-league', async (req,res)=>{
 try{
  const {leagueId,leagueName,days}=req.body||{};if(!leagueId||!leagueName)return res.status(400).json({error:'leagueId ve leagueName gerekli'});
  const powerRating=require('../services/powerRatingService');
  res.json(await powerRating.rebuildLeagueFromSportmonks({leagueId,leagueName,days:Math.min(730,Math.max(60,Number(days)||365))}));
 }catch(error){console.error('[power-rating-rebuild-league]',error);res.status(500).json({error:'League power rating rebuild başarısız'});}
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
