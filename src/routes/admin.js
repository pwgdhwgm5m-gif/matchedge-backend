const express = require('express');
const User = require('../models/User');
const LoginEvent = require('../models/LoginEvent');
const ledger = require('../services/predictionLedgerService');
const premiumLab = require('../services/premiumLabService');
const ModelCalibration = require('../models/ModelCalibration');
const { requireAuth } = require('../middleware/authMiddleware');
const { hashPassword } = require('../services/authService');
const config = require('../config/config');
const { requireAdmin } = require('../middleware/adminMiddleware');

const router = express.Router();

// One-time recovery for the reserved admin account. Requires the server-side
// bootstrap secret and disables itself after a successful password change.
router.post('/setup-password', async (req,res)=>{
 try{
  const setupSecret=String(req.body?.setupSecret||''),newPassword=String(req.body?.newPassword||'');
  const expected=String(process.env.ADMIN_BOOTSTRAP_PASSWORD||'');
  if(!expected||setupSecret!==expected)return res.status(403).json({error:'Setup authorization invalid or disabled.'});
  if(newPassword.length<12)return res.status(400).json({error:'New admin password must be at least 12 characters.'});
  const user=await User.findOne({username:config.adminUsername});
  if(!user)return res.status(404).json({error:'Reserved admin account not found.'});
  user.role='admin';user.emailVerified=true;user.passwordHash=await hashPassword(newPassword);await user.save();
  res.json({ok:true,username:user.username,message:'Admin password updated. Remove ADMIN_BOOTSTRAP_PASSWORD from Render now.'});
 }catch(error){console.error('[admin/setup-password]',error.message);res.status(500).json({error:'Admin password setup failed.'})}
});

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
        matchSimulation: { status: 'staged', source: '50K Poisson Monte Carlo cross-check' },
        valueFinder: { status: 'provider-dependent', source: 'The Odds API live h2h + de-vig + model EV; returns no value claim when prices are unavailable' },
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

router.get('/premium-lab/validation-report', async (req,res)=>{try{res.json(await premiumLab.validationReport())}catch(error){res.status(500).json({error:error.message||'Validation report failed'})}});
router.post('/premium-lab/capture-validation', async (req,res)=>{try{res.json(await premiumLab.captureValidation())}catch(error){res.status(500).json({error:error.message||'Validation capture failed'})}});
router.get('/premium-lab/coupon-audit', async (req,res)=>{try{const risks=['low','medium','high'],legs=[2,3,4,5],runs=[];for(const risk of risks)for(const n of legs){const x=await premiumLab.buildCoupon({risk,legs:n,league:req.query.league||''});runs.push({risk,legs:n,engine:x.engine,count:x.count,complete:x.complete,confidence:x.couponConfidence,combined:x.riskAdjustedCombinedHitPercent,rejected:x.rejectedCount||0,optimizer:x.optimizer,picks:x.picks.map(p=>({fixtureId:p.fixtureId,match:p.match,key:p.key,label:p.label,probability:p.probability,quality:p.dataQualityScore,simulation:p.simulationProbability,gap:p.modelSimulationGap,similar:p.similarMatches,pattern:p.pattern,market:p.market,strength:p.strength}))})}res.json({generatedAt:new Date().toISOString(),runs})}catch(error){res.status(500).json({error:error.message||'Coupon audit failed'})}});
router.post('/premium-lab/coupon-builder', async (req,res)=>{try{res.json(await premiumLab.buildCoupon(req.body||{}))}catch(error){console.error('[premium-lab/coupon]',error);res.status(500).json({error:'Premium kupon oluşturulamadı.'})}});
router.get('/premium-lab/simulate/:fixtureId', async (req,res)=>{try{res.json(await premiumLab.simulateFixture(req.params.fixtureId))}catch(error){res.status(error.status||500).json({error:error.message||'Simülasyon oluşturulamadı.'})}});
router.get('/premium-lab/value-finder', async (req,res)=>{try{res.json(await premiumLab.valueFinder(req.query||{}))}catch(error){res.status(500).json({error:error.message||'Canlı oran analizi oluşturulamadı.'})}});
router.get('/premium-lab/patterns', async (req,res)=>{try{res.json(await premiumLab.patternFinder(req.query||{}))}catch(error){res.status(500).json({error:error.message||'Pattern analizi oluşturulamadı.'})}});
router.get('/premium-lab/similar/:fixtureId', async (req,res)=>{try{res.json(await premiumLab.similarMatches(req.params.fixtureId,{limit:req.query.limit}))}catch(error){res.status(error.status||500).json({error:error.message||'Benzer maçlar oluşturulamadı.'})}});
router.get('/premium-lab/fixtures', async (req,res)=>{try{const rows=await premiumLab.available(80);res.json({matches:rows.map(x=>({fixtureId:x.fixtureId,kickoff:x.kickoff,league:x.league,homeTeam:x.homeTeam,awayTeam:x.awayTeam,strongestPick:x.strongestPick}))})}catch(error){res.status(500).json({error:'Premium maç listesi alınamadı.'})}});

router.get('/model-dashboard',async(req,res)=>{try{const [performance,v4,groups,paired]=await Promise.all([ledger.performance(),ledger.v4ActivationStatus(),ledger.v4CrossCheckPerformance(),ledger.pairedAudit()]);res.json({generatedAt:new Date().toISOString(),socceredge:{version:performance.version,strongestPick:performance.strongestPick,summary:performance.summary},v4:{activation:v4,agreementGroups:groups},pairedAudit:paired});}catch(error){console.error('[model-dashboard]',error);res.status(500).json({error:'Model dashboard unavailable.'})}});

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
