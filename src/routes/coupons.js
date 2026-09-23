const express = require('express');
const Coupon = require('../models/Coupon');
const User = require('../models/User');
const CommunityPick = require('../models/CommunityPick');
const { requireAuth } = require('../middleware/authMiddleware');
const sportsDb = require('../services/sportsDbService');
const footballDataOrg = require('../services/footballDataOrgService');
const sportmonks = require('../services/sportmonksService');
const bsdService = require('../services/bsdService');
const fixtureIdentity = require('../services/fixtureIdentityService');
const { ensureWallet, COUPON_STAKE, ALLOWED_STAKES, calculatePayout } = require('../services/gamificationService');

const router = express.Router();
router.use(requireAuth);
const settlementInFlight = new Set();
function settlePendingBackground(userId) {
  const key=String(userId);
  if(settlementInFlight.has(key)) return;
  settlementInFlight.add(key);
  settlePending(userId).catch(e=>console.warn('[coupons/background-settle]',key,e.message)).finally(()=>settlementInFlight.delete(key));
}

const CORNER_KEYS = new Set(['cornersOver95','cornersUnder95','cornersOver85','cornersUnder85']);
const CORNER_SETTLEMENT_LEAGUES = new Set(['premier league','la liga','bundesliga','serie a','ligue 1','turkish super lig']);
function couponLeagueKey(v){return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ü/g,'u').replace(/[^a-z0-9]+/g,' ').trim().replace(/^super lig$/,'turkish super lig')}
function cornerCouponSupported(league){return CORNER_SETTLEMENT_LEAGUES.has(couponLeagueKey(league))}
const ALLOWED_KEYS = new Set([
  'home','draw','away',
  'over15','over25','under25','over35','under35',
  'bttsYes','bttsNo',
  'homeScores','awayScores','homeOver15','homeOver25','homeOver35','awayOver15','awayOver25','awayOver35',
  'cornersOver95','cornersUnder95','cornersOver85','cornersUnder85',
  'fhHome','fhDraw','fhAway','fhHomeScores','fhAwayScores','fhOver05',
  'shHome','shDraw','shAway','shHomeScores','shAwayScores','shOver05',
  'mostGoalsFirst','mostGoalsEqual','mostGoalsSecond'
]);

function settleSelection(key, home, away, corners, halftimeHome, halftimeAway) {
  const total = home + away;
  if (key === 'home') return home > away ? 'won' : 'lost';
  if (key === 'draw') return home === away ? 'won' : 'lost';
  if (key === 'away') return away > home ? 'won' : 'lost';
  if (key === 'over15') return total > 1.5 ? 'won' : 'lost';
  if (key === 'over25') return total > 2.5 ? 'won' : 'lost';
  if (key === 'under25') return total < 2.5 ? 'won' : 'lost';
  if (key === 'over35') return total > 3.5 ? 'won' : 'lost';
  if (key === 'under35') return total < 3.5 ? 'won' : 'lost';
  if (key === 'bttsYes') return home > 0 && away > 0 ? 'won' : 'lost';
  if (key === 'bttsNo') return home === 0 || away === 0 ? 'won' : 'lost';
  if (key === 'homeScores') return home >= 1 ? 'won' : 'lost';
  if (key === 'awayScores') return away >= 1 ? 'won' : 'lost';
  if (key === 'homeOver05') return home >= 1 ? 'won' : 'lost';
  if (key === 'homeOver15') return home >= 2 ? 'won' : 'lost';
  if (key === 'homeOver25') return home >= 3 ? 'won' : 'lost';
  if (key === 'homeOver35') return home >= 4 ? 'won' : 'lost';
  if (key === 'awayOver05') return away >= 1 ? 'won' : 'lost';
  if (key === 'awayOver15') return away >= 2 ? 'won' : 'lost';
  if (key === 'awayOver25') return away >= 3 ? 'won' : 'lost';
  if (key === 'awayOver35') return away >= 4 ? 'won' : 'lost';
  if (key === 'cornersOver95') return corners == null ? 'void' : corners >= 10 ? 'won' : 'lost';
  if (key === 'cornersUnder95') return corners == null ? 'void' : corners <= 9 ? 'won' : 'lost';
  // Legacy 8.5 coupons remain settleable.
  if (key === 'cornersOver85') return corners == null ? 'void' : corners >= 9 ? 'won' : 'lost';
  if (key === 'cornersUnder85') return corners == null ? 'void' : corners <= 8 ? 'won' : 'lost';
  if (halftimeHome == null || halftimeAway == null) return 'void';
  const secondHome = home - halftimeHome;
  const secondAway = away - halftimeAway;
  const firstGoals = halftimeHome + halftimeAway;
  const secondGoals = secondHome + secondAway;
  if (key === 'fhHome') return halftimeHome > halftimeAway ? 'won' : 'lost';
  if (key === 'fhDraw') return halftimeHome === halftimeAway ? 'won' : 'lost';
  if (key === 'fhAway') return halftimeAway > halftimeHome ? 'won' : 'lost';
  if (key === 'fhHomeScores') return halftimeHome >= 1 ? 'won' : 'lost';
  if (key === 'fhAwayScores') return halftimeAway >= 1 ? 'won' : 'lost';
  if (key === 'fhOver05') return firstGoals >= 1 ? 'won' : 'lost';
  if (key === 'shHome') return secondHome > secondAway ? 'won' : 'lost';
  if (key === 'shDraw') return secondHome === secondAway ? 'won' : 'lost';
  if (key === 'shAway') return secondAway > secondHome ? 'won' : 'lost';
  if (key === 'shHomeScores') return secondHome >= 1 ? 'won' : 'lost';
  if (key === 'shAwayScores') return secondAway >= 1 ? 'won' : 'lost';
  if (key === 'shOver05') return secondGoals >= 1 ? 'won' : 'lost';
  if (key === 'mostGoalsFirst') return firstGoals > secondGoals ? 'won' : 'lost';
  if (key === 'mostGoalsEqual') return firstGoals === secondGoals ? 'won' : 'lost';
  if (key === 'mostGoalsSecond') return secondGoals > firstGoals ? 'won' : 'lost';
  return 'void';
}

function settleSelectionWithAvailableData(key,home,away,corners,halftimeHome,halftimeAway){
  const needsCorners=String(key||'').startsWith('corners');
  const needsHalftime=['fhHome','fhDraw','fhAway','fhHomeScores','fhAwayScores','fhOver05','shHome','shDraw','shAway','shHomeScores','shAwayScores','shOver05','mostGoalsFirst','mostGoalsEqual','mostGoalsSecond'].includes(key);
  if(needsCorners&&corners==null)return 'pending';
  if(needsHalftime&&(halftimeHome==null||halftimeAway==null))return 'pending';
  return settleSelection(key,home,away,corners,halftimeHome,halftimeAway);
}

function normTeam(v){return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\b(fc|cf|sc|afc|fk|sk|calcio|football|club)\b/g,' ').replace(/[^a-z0-9]+/g,' ').trim()}
function teamPairMatch(m,home,away){const h=normTeam(home),a=normTeam(away),mh=normTeam(m?.homeTeam),ma=normTeam(m?.awayTeam);return !!h&&!!a&&!!mh&&!!ma&&(mh===h||mh.includes(h)||h.includes(mh))&&(ma===a||ma.includes(a)||a.includes(ma))}
function finalMatch(m){const s=String(m?.statusShort||m?.status||'').toUpperCase();return !!m&&(m.isFinished===true||['FT','AET','PEN','AWARDED'].includes(s))&&m.homeScore!=null&&m.awayScore!=null}
const SPORTMONKS_RESULT_LEAGUES=new Set(['premier league','la liga','bundesliga','serie a','ligue 1','turkish super lig']);
function sportmonksResultLeague(league){return SPORTMONKS_RESULT_LEAGUES.has(couponLeagueKey(league))}
async function resolveBsdFinal(matchDate,fixtureId,homeTeam,awayTeam,providerIds,mappedIds,kickoff){
  // Use the exact same BSD v2 finished-results pool that powers the scoreboard.
  // This prevents a match being visible as FT in Results while remaining pending in a coupon.
  // Search adjacent UTC dates too: the stored kickoff date and the provider's
  // local fixture date can differ around midnight. Match exact provider ID first.
  const day=new Date(matchDate+'T12:00:00Z');
  const dates=[0,-1,1].map(offset=>new Date(day.getTime()+offset*86400000).toISOString().slice(0,10));
  const knownIds=[providerIds.bsd,mappedIds.bsd].filter(Boolean).map(String);
  for(const date of dates){
    const pool=await bsdService.getRawFinalMatchesForDate(date).catch(()=>({ok:false,matches:[]}));
    if(!pool.ok)continue;
    const rows=pool.matches||[];
    const hit=rows.find(m=>knownIds.includes(String(m.fixtureId||m.bsdId||m.eventId||''))&&finalMatch(m))
      ||rows.find(m=>teamPairMatch(m,homeTeam,awayTeam)&&finalMatch(m));
    if(hit)return {source:'bsd-results-pool',match:hit,date};
  }
  // New coupon fixture IDs are BSD IDs when explicitly marked; legacy IDs
  // can be other providers, so only probe the raw ID after name/date matching.
  let bsdId=providerIds.bsd||mappedIds.bsd||null;
  if(!bsdId) bsdId=await bsdService.resolveBsdEventId(homeTeam,awayTeam,kickoff||matchDate+'T19:45:00Z').catch(()=>null);
  let bsd=bsdId?await bsdService.getFinalResultByEventId?.(bsdId).catch(()=>({available:false})):null;
  if(!bsd?.available) bsd=await bsdService.getFinalResultForMatch(homeTeam,awayTeam,kickoff||matchDate+'T19:45:00Z').catch(()=>({available:false}));
  // The daily result pool can omit a match without a mapped league or when
  // pagination/provider filters lag. Direct BSD ID lookup still works.
  if(!bsd?.available && !bsdId && fixtureId){
    const direct=await bsdService.getFinalResultByEventId(fixtureId).catch(()=>({available:false}));
    if(direct?.available)bsd=direct;
  }
  if(!bsd?.available)return null;
  return {source:'bsd',match:{fixtureId:String(bsd.eventId||fixtureId),homeTeam,awayTeam,homeScore:bsd.homeScore,awayScore:bsd.awayScore,halftimeHome:bsd.halftimeHome,halftimeAway:bsd.halftimeAway,statusShort:'FT',isFinished:true},date:matchDate};
}
async function canonicalResult(matchDate,fixtureId,homeTeam,awayTeam,providerIds={},league='',kickoff=null){
  // Only BSD is authoritative for coupon results and final scores.
  // Never settle a slip using SportsDB, SportMonks or Football-Data scores.
  const mapped=await fixtureIdentity.lookup({date:matchDate,home:homeTeam,away:awayTeam}).catch(()=>null);
  const mappedIds=Object.fromEntries((mapped?.providers||[]).map(p=>[p.provider,p.id]));
  return await resolveBsdFinal(matchDate,fixtureId,homeTeam,awayTeam,providerIds,mappedIds,kickoff)
    || {source:null,match:null};
}
function bsdCornerTotal(payload){
  const root=payload?.data?.data||payload?.data||payload;
  const blocks=[root?.stats,root?.statistics,root?.team_stats,root?.teamStats,root];
  const number=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
  const cornerOf=side=>{
    if(!side||typeof side!=='object')return null;
    for(const k of ['corner_kicks','corners','cornerKicks']){
      const n=number(side[k]);if(n!==null)return n;
    }
    return null;
  };
  for(const b of blocks){
    if(!b||typeof b!=='object')continue;
    for(const pair of [[b.home,b.away],[b.full_time?.home,b.full_time?.away],[b.fulltime?.home,b.fulltime?.away],[b.total?.home,b.total?.away]]){
      const h=cornerOf(pair[0]),a=cornerOf(pair[1]);
      if(h!==null&&a!==null)return h+a;
    }
    for(const k of ['corner_kicks','corners']){
      const h=number(b[k]?.home),a=number(b[k]?.away);
      if(h!==null&&a!==null)return h+a;
    }
  }
  return null; // BSD null means unreported, never zero.
}
async function settlePending(userId) {
  // Resolve oldest pending slips first. A newest-first limit can permanently
  // starve older coupons when a user has many pending slips.
  // Keep grading every leg until every match has its own final result.
  // A coupon may already be LOST because one leg lost, while other legs are
  // still pending; those legs must still be graded for the UI/history.
  const coupons=await Coupon.find({userId,$or:[{status:'pending'},{'legs.selection.result':'pending'},{'selections.result':'pending'}]}).sort({createdAt:1}).limit(100);
  for(const coupon of coupons){
    // Migrate/settle legacy one-match coupons created before multi-leg slips.
    if(!coupon.legs?.length){
      if(!coupon.fixtureId || !coupon.matchDate || !(coupon.selections||[]).length) continue;
      const resolved=await canonicalResult(coupon.matchDate,coupon.fixtureId,coupon.homeTeam,coupon.awayTeam,{},coupon.league||'',coupon.kickoff||null);
      const match=resolved.match;
      if(!match)continue;
      let corners=null;
      if(coupon.selections.some(s=>String(s.key||'').startsWith('corners'))){
        const stats=await bsdService.getStatsForMatch(coupon.homeTeam,coupon.awayTeam,coupon.kickoff);
        if(stats.available)corners=bsdCornerTotal(stats);
        if(corners==null&&match?.statistics)corners=bsdCornerTotal(match.statistics);
      }
      for(const selection of coupon.selections){
        if(selection.result!=='pending')continue;
        selection.result=settleSelectionWithAvailableData(selection.key,match.homeScore,match.awayScore,corners,match.halftimeHome,match.halftimeAway);
      }
      const legacyResults=coupon.selections.map(s=>s.result);
      coupon.status=legacyResults.some(x=>x==='lost')?'lost':legacyResults.some(x=>x==='pending')?'pending':legacyResults.some(x=>x==='won')?'won':'void';
      coupon.finalScore={home:match.homeScore,away:match.awayScore};
      coupon.settledAt=coupon.status==='pending'?null:new Date();
      coupon.markModified('selections');
      try { await coupon.save(); } catch (e) { if (e.name === 'VersionError') continue; throw e; }
      if(coupon.status!=='pending'&&!coupon.rewardedAt){
        const claimed=await Coupon.findOneAndUpdate({_id:coupon._id,rewardedAt:null},{$set:{rewardedAt:new Date()}},{new:true});
        if(claimed){
          const wins=coupon.selections.filter(s=>s.result==='won').length;
          if(coupon.status==='won') await User.findByIdAndUpdate(userId,{$inc:{edgeCoins:coupon.potentialPayout||coupon.stakeCoins||COUPON_STAKE,totalCoinsWon:coupon.potentialPayout||coupon.stakeCoins||COUPON_STAKE}});
          else if(coupon.status==='lost') {}
          else await User.findByIdAndUpdate(userId,{$inc:{edgeCoins:coupon.stakeCoins||COUPON_STAKE}});
        }
      }
      continue;
    }
    for(const leg of coupon.legs){
      if(leg.selection.result!=='pending') continue;
      if(!leg.matchDate) continue;
      const resolved=await canonicalResult(leg.matchDate,leg.fixtureId,leg.homeTeam,leg.awayTeam,leg.providerIds||{},leg.league||'',leg.kickoff||null);
      const match=resolved.match;
      if(!match && leg.finalScore?.home!=null && leg.finalScore?.away!=null){
        const result=settleSelectionWithAvailableData(leg.selection.key,Number(leg.finalScore.home),Number(leg.finalScore.away),null,null,null);
        if(result!=='pending'){leg.selection.result=result;continue;}
      }
      if(!match){console.log('[coupons/settle-miss]',JSON.stringify({fixtureId:leg.fixtureId,date:leg.matchDate,home:leg.homeTeam,away:leg.awayTeam}));continue;}
      let corners=null;
      if(leg.selection.key.startsWith('corners')){
        const stats=await bsdService.getStatsForMatch(leg.homeTeam,leg.awayTeam,leg.kickoff);
        if(stats.available)corners=bsdCornerTotal(stats);
        if(corners==null&&match?.statistics)corners=bsdCornerTotal(match.statistics);
      }
      leg.selection.result=settleSelectionWithAvailableData(leg.selection.key,match.homeScore,match.awayScore,corners,match.halftimeHome,match.halftimeAway);
      leg.finalScore={home:match.homeScore,away:match.awayScore};
    }
    const results=coupon.legs.map(l=>l.selection.result);
    coupon.status=results.some(x=>x==='lost')?'lost':results.some(x=>x==='pending')?'pending':results.some(x=>x==='won')?'won':'void';
    coupon.settledAt=coupon.status==='pending'?null:new Date(); coupon.markModified('legs');
    try { await coupon.save(); } catch (e) { if (e.name === 'VersionError') continue; throw e; }
    if(coupon.status!=='pending'&&!coupon.rewardedAt){
      const claimed=await Coupon.findOneAndUpdate({_id:coupon._id,rewardedAt:null},{$set:{rewardedAt:new Date()}},{new:true});
      if(claimed){
        const wins=coupon.legs.filter(l=>l.selection.result==='won').length;
        if(coupon.status==='won'){
          const payout=coupon.potentialPayout||coupon.stakeCoins||COUPON_STAKE,xp=20+wins*5+(wins>=5?25:0);
          const updated=await User.findByIdAndUpdate(userId,{$inc:{edgeCoins:payout,totalCoinsWon:payout,xp}},{new:true});
        }else if(coupon.status==='lost'){}
        else await User.findByIdAndUpdate(userId,{$inc:{edgeCoins:coupon.stakeCoins||COUPON_STAKE}});
      }
    }
  }
  return coupons.length;
}
async function cleanupFinishedCoupons(){
  // A slip can become LOST as soon as one leg loses while later legs are
  // still pending. Never purge it until every leg/selection is settled.
  const result=await Coupon.deleteMany({
    status:{$in:['won','lost','void']},
    'legs.selection.result':{$ne:'pending'},
    'selections.result':{$ne:'pending'}
  });
  return Number(result.deletedCount||0);
}

async function settleAllPendingCoupons() {
  const userIds = await Coupon.distinct('userId', { $or:[{status:'pending'},{'legs.selection.result':'pending'},{'selections.result':'pending'}] });
  let usersChecked = 0;
  for (const userId of userIds) {
    try {
      await settlePending(userId);
      usersChecked += 1;
    } catch (error) {
      console.warn('[coupons/auto-settle]', String(userId), error.message);
    }
  }
  return usersChecked;
}

router.get('/', async (req, res) => {
  try {
    // Never block the coupon screen on external score/stat providers.
    // Settlement still runs automatically, but in the background with a
    // per-user in-flight guard so repeated polling cannot fan out API calls.
    settlePendingBackground(req.user.userId);
    const coupons = await Coupon.find({ userId: req.user.userId }).sort({ createdAt: -1 }).limit(100).lean();
    res.json({ coupons, settlementRunning: settlementInFlight.has(String(req.user.userId)) });
  } catch (error) {
    console.error('[coupons/get]', error.message);
    res.status(500).json({ error: 'Kuponlar alınamadı.' });
  }
});

router.post('/', async (req, res) => {
  const { legs, stakeCoins } = req.body;
  if(Array.isArray(legs)&&legs.length>3) return res.status(400).json({error:'Bir kuponda en fazla 3 maç seçilebilir.',code:'MAX_3_LEGS'});
  const rawLegs = Array.isArray(legs) ? legs.slice(0,3) : [];
  const safeLegs = rawLegs.map(leg => {
    const s=leg?.selection||{};
    if(!leg?.fixtureId||!leg?.homeTeam||!leg?.awayTeam||!ALLOWED_KEYS.has(s.key)) return null;
    const date=leg.kickoff?new Date(leg.kickoff):null;
    return {fixtureId:String(leg.fixtureId),homeTeam:String(leg.homeTeam).slice(0,80),awayTeam:String(leg.awayTeam).slice(0,80),
      league:String(leg.league||'').slice(0,80),kickoff:date,matchDate:date&&!Number.isNaN(date.getTime())?date.toISOString().slice(0,10):null,
      selection:{key:s.key,market:String(s.market||'').slice(0,30),label:String(s.label||'').slice(0,50),probability:Number(s.probability)||null},
      providerIds:{sportsdb:String(leg.providerIds?.sportsdb||''),sportmonks:String(leg.providerIds?.sportmonks||''),bsd:String(leg.providerIds?.bsd||''),footballData:String(leg.providerIds?.footballData||'')}};
  }).filter(Boolean);
  if(!safeLegs.length) return res.status(400).json({error:'En az bir geçerli seçim gerekli.'});
  if(safeLegs.some(x=>CORNER_KEYS.has(x.selection.key)&&!cornerCouponSupported(x.league))) return res.status(422).json({error:'Korner seçimi bu ligde kupona eklenemez; sonuç korner verisi desteklenmiyor.',code:'CORNER_SETTLEMENT_UNSUPPORTED'});
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
    res.status(201).json({coupon,balance:user.edgeCoins});
  }catch(error){console.error('[coupons/create]',error.message);res.status(500).json({error:'Kupon oluşturulamadı.'})}
});
router.post('/recompute', async (req,res)=>{
  try{
    // Recompute pending selections from final scores already persisted on the coupon.
    // This is provider-independent and repairs old slips without changing settled/rewarded ones.
    const coupons=await Coupon.find({userId:req.user.userId,$or:[{status:'pending'},{'legs.selection.result':'pending'},{'selections.result':'pending'}]}).sort({createdAt:1}).limit(250);
    let couponsUpdated=0, selectionsUpdated=0;
    for(const coupon of coupons){
      let changed=false;
      if(coupon.legs?.length){
        for(const leg of coupon.legs){
          if(leg.selection?.result!=='pending')continue;
          const h=leg.finalScore?.home,a=leg.finalScore?.away;
          if(h==null||a==null)continue;
          const r=settleSelectionWithAvailableData(leg.selection.key,Number(h),Number(a),null,null,null);
          if(r!=='pending'){leg.selection.result=r;changed=true;selectionsUpdated++}
        }
        if(changed){
          const rs=coupon.legs.map(l=>l.selection.result);
          coupon.status=rs.some(x=>x==='lost')?'lost':rs.some(x=>x==='pending')?'pending':rs.some(x=>x==='won')?'won':'void';
          coupon.settledAt=coupon.status==='pending'?null:new Date();coupon.markModified('legs');await coupon.save();couponsUpdated++;
        }
      }else if(coupon.finalScore?.home!=null&&coupon.finalScore?.away!=null){
        for(const s of coupon.selections||[]){if(s.result==='pending'){const r=settleSelectionWithAvailableData(s.key,Number(coupon.finalScore.home),Number(coupon.finalScore.away),null,null,null);if(r!=='pending'){s.result=r;changed=true;selectionsUpdated++}}}
        if(changed){const rs=coupon.selections.map(s=>s.result);coupon.status=rs.some(x=>x==='lost')?'lost':rs.some(x=>x==='pending')?'pending':rs.some(x=>x==='won')?'won':'void';coupon.settledAt=coupon.status==='pending'?null:new Date();coupon.markModified('selections');await coupon.save();couponsUpdated++}
      }
    }
    // Then refresh unresolved slips from BSD and return diagnostics so a 200
    // response cannot hide provider/matching misses.
    await settlePending(req.user.userId);
    const remaining=await Coupon.find({userId:req.user.userId,$or:[{status:'pending'},{'legs.selection.result':'pending'},{'selections.result':'pending'}]}).sort({createdAt:1}).limit(20).lean();
    const pending=[];
    for(const coupon of remaining){
      const legs=coupon.legs?.length?coupon.legs:(coupon.selections||[]).map(selection=>({fixtureId:coupon.fixtureId,matchDate:coupon.matchDate,homeTeam:coupon.homeTeam,awayTeam:coupon.awayTeam,kickoff:coupon.kickoff,providerIds:{},selection}));
      for(const leg of legs){
        if(leg.selection?.result!=='pending')continue;
        const resolved=await canonicalResult(leg.matchDate,leg.fixtureId,leg.homeTeam,leg.awayTeam,leg.providerIds||{},leg.league||'',leg.kickoff||null);
        pending.push({couponId:String(coupon._id),fixtureId:String(leg.fixtureId||''),home:leg.homeTeam,away:leg.awayTeam,key:leg.selection?.key,bsdResolved:!!resolved.match,bsdScore:resolved.match?{home:resolved.match.homeScore,away:resolved.match.awayScore,htHome:resolved.match.halftimeHome,htAway:resolved.match.halftimeAway}:null,source:resolved.source||null});
      }
    }
    console.log('[coupons/recompute-diagnostic]',JSON.stringify(pending));
    res.json({ok:true,couponsUpdated,selectionsUpdated,pending});
  }catch(error){console.error('[coupons/recompute]',error.message);res.status(500).json({error:'Kuponlar yeniden hesaplanamadı.'})}
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

router.delete('/:id/legs/:fixtureId', async (req,res)=>{
  const coupon=await Coupon.findOne({_id:req.params.id,userId:req.user.userId});
  if(!coupon)return res.status(404).json({error:'Kupon bulunamadı.'});
  if(coupon.status!=='pending')return res.status(409).json({error:'Sonuçlanmış kupon değiştirilemez.'});
  const leg=(coupon.legs||[]).find(l=>String(l.fixtureId)===String(req.params.fixtureId));
  if(!leg)return res.status(404).json({error:'Maç kuponda bulunamadı.'});
  if(leg.kickoff&&new Date(leg.kickoff).getTime()<=Date.now())return res.status(409).json({error:'Başlamış maç kupondan silinemez.'});
  coupon.legs=coupon.legs.filter(l=>String(l.fixtureId)!==String(req.params.fixtureId));
  if(!coupon.legs.length){await coupon.deleteOne();return res.json({deleted:true,couponDeleted:true})}
  const payout=calculatePayout(coupon.legs.map(x=>x.selection),coupon.stakeCoins||COUPON_STAKE);
  coupon.payoutMultiplier=payout.multiplier;coupon.potentialPayout=payout.payout;coupon.markModified('legs');await coupon.save();
  res.json({deleted:true,coupon});
});

router.delete('/:id', async (req, res) => {
  const coupon = await Coupon.findOne({ _id: req.params.id, userId: req.user.userId });
  if (!coupon) return res.status(404).json({ error: 'Kupon bulunamadı.' });
  if(coupon.status==='pending'){
    const allKickoffs=(coupon.legs||[]).map(l=>l.kickoff).filter(Boolean);
    if(coupon.kickoff)allKickoffs.push(coupon.kickoff);
    if(allKickoffs.some(k=>new Date(k).getTime()<=Date.now()))return res.status(409).json({error:'Başlamış maç içeren kupon silinemez.'});
    await User.findByIdAndUpdate(req.user.userId,{$inc:{edgeCoins:coupon.stakeCoins||COUPON_STAKE,totalCoinsSpent:-(coupon.stakeCoins||COUPON_STAKE)}});
  }
  await coupon.deleteOne();
  res.json({ deleted: true });
});

router.settleAllPendingCoupons = settleAllPendingCoupons;
router.cleanupFinishedCoupons = cleanupFinishedCoupons;
module.exports = router;
