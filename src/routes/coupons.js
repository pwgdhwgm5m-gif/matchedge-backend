const express = require('express');
const Coupon = require('../models/Coupon');
const User = require('../models/User');
const CommunityPick = require('../models/CommunityPick');
const { requireAuth } = require('../middleware/authMiddleware');
const sportsDb = require('../services/sportsDbService');
const footballDataOrg = require('../services/footballDataOrgService');
const { ensureWallet, COUPON_STAKE, ALLOWED_STAKES, calculatePayout } = require('../services/gamificationService');

const router = express.Router();
router.use(requireAuth);

const ALLOWED_KEYS = new Set(['home', 'draw', 'away', 'over25', 'under25', 'bttsYes', 'bttsNo', 'cornersOver95', 'cornersUnder95', 'cornersOver85', 'cornersUnder85', 'fhHome', 'fhDraw', 'fhAway', 'shHome', 'shDraw', 'shAway', 'mostGoalsFirst', 'mostGoalsEqual', 'mostGoalsSecond']);

function settleSelection(key, home, away, corners, halftimeHome, halftimeAway) {
  const total = home + away;
  if (key === 'home') return home > away ? 'won' : 'lost';
  if (key === 'draw') return home === away ? 'won' : 'lost';
  if (key === 'away') return away > home ? 'won' : 'lost';
  if (key === 'over25') return total > 2.5 ? 'won' : 'lost';
  if (key === 'under25') return total < 2.5 ? 'won' : 'lost';
  if (key === 'bttsYes') return home > 0 && away > 0 ? 'won' : 'lost';
  if (key === 'bttsNo') return home === 0 || away === 0 ? 'won' : 'lost';
  if (key === 'cornersOver95') return corners == null ? 'void' : corners >= 10 ? 'won' : 'lost';
  if (key === 'cornersUnder95') return corners == null ? 'void' : corners <= 9 ? 'won' : 'lost';
  // Legacy 8.5 coupons remain settleable.
  if (key === 'cornersOver85') return corners == null ? 'void' : corners >= 9 ? 'won' : 'lost';
  if (key === 'cornersUnder85') return corners == null ? 'void' : corners <= 8 ? 'won' : 'lost';
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
  const coupons=await Coupon.find({userId,status:'pending'}).sort({createdAt:-1}).limit(30);
  for(const coupon of coupons){
    // Legacy one-match coupons keep the old settlement path below this migration boundary.
    if(!coupon.legs?.length) continue;
    for(const leg of coupon.legs){
      if(leg.selection.result!=='pending') continue;
      if(!leg.matchDate) continue;
      const [raw,verified]=await Promise.all([sportsDb.getMatchesByDate(leg.matchDate),footballDataOrg.getMatchesByDate(leg.matchDate)]);
      let matches=raw.ok?(raw.data?.events||[]).map(sportsDb.transformEvent):[];
      if(verified.ok)matches=footballDataOrg.mergeVerifiedScores(matches,verified.matches);
      matches=await sportsDb.attachHalftimeScores(matches);
      const match=matches.find(m=>String(m.fixtureId)===String(leg.fixtureId));
      if(!match||match.statusShort!=='FT')continue;
      let corners=null;
      if(leg.selection.key.startsWith('corners')){
        const stats=await sportsDb.getEventStatsFormatted(leg.fixtureId);
        if(stats.available&&stats.stats?.corners)corners=Number(stats.stats.corners.home||0)+Number(stats.stats.corners.away||0);
      }
      leg.selection.result=settleSelection(leg.selection.key,match.homeScore,match.awayScore,corners,match.halftimeHome,match.halftimeAway);
      leg.finalScore={home:match.homeScore,away:match.awayScore};
      await CommunityPick.updateOne({userId,fixtureId:leg.fixtureId,key:leg.selection.key},{$set:{result:leg.selection.result,settledAt:new Date()}});
    }
    const results=coupon.legs.map(l=>l.selection.result);
    coupon.status=results.some(x=>x==='lost')?'lost':results.some(x=>x==='pending')?'pending':results.some(x=>x==='won')?'won':'void';
    coupon.settledAt=coupon.status==='pending'?null:new Date(); coupon.markModified('legs'); await coupon.save();
    if(coupon.status!=='pending'&&!coupon.rewardedAt){
      const claimed=await Coupon.findOneAndUpdate({_id:coupon._id,rewardedAt:null},{$set:{rewardedAt:new Date()}},{new:true});
      if(claimed){
        const wins=coupon.legs.filter(l=>l.selection.result==='won').length;
        if(coupon.status==='won'){
          const payout=coupon.potentialPayout||coupon.stakeCoins||COUPON_STAKE,xp=20+wins*5+(wins>=5?25:0);
          const updated=await User.findByIdAndUpdate(userId,{$inc:{edgeCoins:payout,totalCoinsWon:payout,xp,correctPicks:wins,currentStreak:1}},{new:true});
          if(updated&&updated.currentStreak>updated.bestStreak){updated.bestStreak=updated.currentStreak;await updated.save()}
        }else if(coupon.status==='lost')await User.findByIdAndUpdate(userId,{$inc:{wrongPicks:coupon.legs.filter(l=>l.selection.result==='lost').length},$set:{currentStreak:0}});
        else await User.findByIdAndUpdate(userId,{$inc:{edgeCoins:coupon.stakeCoins||COUPON_STAKE}});
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
  const { legs, stakeCoins } = req.body;
  const rawLegs = Array.isArray(legs) ? legs.slice(0,8) : [];
  const safeLegs = rawLegs.map(leg => {
    const s=leg?.selection||{};
    if(!leg?.fixtureId||!leg?.homeTeam||!leg?.awayTeam||!ALLOWED_KEYS.has(s.key)) return null;
    const date=leg.kickoff?new Date(leg.kickoff):null;
    return {fixtureId:String(leg.fixtureId),homeTeam:String(leg.homeTeam).slice(0,80),awayTeam:String(leg.awayTeam).slice(0,80),
      league:String(leg.league||'').slice(0,80),kickoff:date,matchDate:date&&!Number.isNaN(date.getTime())?date.toISOString().slice(0,10):null,
      selection:{key:s.key,market:String(s.market||'').slice(0,30),label:String(s.label||'').slice(0,50),probability:Number(s.probability)||null}};
  }).filter(Boolean);
  if(!safeLegs.length) return res.status(400).json({error:'En az bir geçerli seçim gerekli.'});
  if(new Set(safeLegs.map(x=>x.fixtureId)).size!==safeLegs.length) return res.status(400).json({error:'Her maçtan yalnızca bir seçim eklenebilir.'});
  if(safeLegs.some(x=>x.kickoff&&!Number.isNaN(x.kickoff.getTime())&&x.kickoff.getTime()<=Date.now())) return res.status(409).json({error:'Başlamış maç kupona eklenemez.'});
  try{
    let user=await User.findById(req.user.userId); if(!user)return res.status(404).json({error:'Kullanıcı bulunamadı.'});
    if(ensureWallet(user))await user.save();
    const stake=ALLOWED_STAKES.includes(Number(stakeCoins))?Number(stakeCoins):COUPON_STAKE;
    user=await User.findOneAndUpdate({_id:req.user.userId,edgeCoins:{$gte:stake}},{$inc:{edgeCoins:-stake,totalCoinsSpent:stake}},{new:true});
    if(!user)return res.status(402).json({error:'Bu kupon için yeterli Edge Coin yok.'});
    const payout=calculatePayout(safeLegs.map(x=>x.selection),stake);
    let coupon;
    try{
      coupon=await Coupon.create({userId:req.user.userId,legs:safeLegs,stakeCoins:stake,payoutMultiplier:payout.multiplier,potentialPayout:payout.payout});
    }catch(error){await User.findByIdAndUpdate(req.user.userId,{$inc:{edgeCoins:stake,totalCoinsSpent:-stake}});throw error}
    await Promise.all(safeLegs.map(leg=>CommunityPick.updateOne(
      {userId:req.user.userId,fixtureId:leg.fixtureId,key:leg.selection.key},
      {$set:{homeTeam:leg.homeTeam,awayTeam:leg.awayTeam,league:leg.league,kickoff:leg.kickoff,market:leg.selection.market,label:leg.selection.label,result:'pending',settledAt:null}},{upsert:true}
    )));
    res.status(201).json({coupon,balance:user.edgeCoins});
  }catch(error){console.error('[coupons/create]',error.message);res.status(500).json({error:'Kupon oluşturulamadı.'})}
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
