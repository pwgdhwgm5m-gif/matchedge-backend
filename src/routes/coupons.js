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
  const pool=await bsdService.getResultMatchesForDate(matchDate).catch(()=>({ok:false,matches:[]}));
  if(pool.ok){
    const hit=(pool.matches||[]).find(m=>teamPairMatch(m,homeTeam,awayTeam));
    if(hit&&finalMatch(hit)) return {source:'bsd-results-pool',match:hit,date:matchDate};
  }
  let bsdId=providerIds.bsd||mappedIds.bsd||null;
  if(!bsdId) bsdId=await bsdService.resolveBsdEventId(homeTeam,awayTeam,kickoff||matchDate+'T19:45:00Z').catch(()=>null);
  let bsd=bsdId?await bsdService.getFinalResultByEventId?.(bsdId).catch(()=>({available:false})):null;
  if(!bsd?.available) bsd=await bsdService.getFinalResultForMatch(homeTeam,awayTeam,kickoff||matchDate+'T19:45:00Z').catch(()=>({available:false}));
  if(!bsd?.available)return null;
  return {source:'bsd',match:{fixtureId:String(bsd.eventId||fixtureId),homeTeam,awayTeam,homeScore:bsd.homeScore,awayScore:bsd.awayScore,halftimeHome:bsd.halftimeHome,halftimeAway:bsd.halftimeAway,statusShort:'FT',isFinished:true},date:matchDate};
}
async function canonicalResult(matchDate,fixtureId,homeTeam,awayTeam,providerIds={},league='',kickoff=null){
  // Coupon fixture IDs are TheSportsDB IDs. The premium V2 livescore feed can
  // still hold the authoritative score after a lower-league/cup match drops
  // out of the compact day/event feeds. Check it first and let
  // transformLiveEvent's stale-match guard turn an expired live status into FT.
  const mapped=await fixtureIdentity.lookup({date:matchDate,home:homeTeam,away:awayTeam}).catch(()=>null);
  const mappedIds=Object.fromEntries((mapped?.providers||[]).map(p=>[p.provider,p.id]));
  const sportsdbId=providerIds.sportsdb||mappedIds.sportsdb||fixtureId;
  const useSportmonksFirst=sportmonksResultLeague(league);
  if(!useSportmonksFirst){
    const bsdFirst=await resolveBsdFinal(matchDate,fixtureId,homeTeam,awayTeam,providerIds,mappedIds,kickoff);
    if(bsdFirst)return bsdFirst;
  }
  if(sportsdbId){
    const live=await sportsDb.getLiveScores().catch(()=>({ok:false}));
    if(live.ok){
      const raw=(live.data?.livescore||[]).find(e=>String(e.idEvent)===String(sportsdbId));
      if(raw){
        let v2=sportsDb.transformLiveEvent(raw);
        v2=(await sportsDb.attachHalftimeScores([v2]))[0]||v2;
        if(finalMatch(v2)) return {source:'sportsdb-v2',match:v2,date:matchDate};
      }
    }
  }
  // Most coupon fixture IDs originate from TheSportsDB. Resolve the exact
  // event first; daily feeds can omit or lag completed matches.
  if(sportsdbId){
    const direct=await sportsDb.getEventById(sportsdbId).catch(()=>({ok:false}));
    const event=direct.ok?(direct.data?.events||[])[0]:null;
    if(event){
      let exact=sportsDb.transformEvent(event);
      exact=(await sportsDb.attachHalftimeScores([exact]))[0]||exact;
      if(finalMatch(exact)) return {source:'sportsdb-id',match:exact,date:matchDate};
    }
  }
  const base=new Date(matchDate+'T12:00:00Z'),dates=[-1,0,1].map(n=>new Date(base.getTime()+n*86400000).toISOString().slice(0,10));
  for(const date of dates){
    const [raw,verified,sm]=await Promise.all([sportsDb.getMatchesByDate(date).catch(()=>({ok:false})),footballDataOrg.getMatchesByDate(date).catch(()=>({ok:false,matches:[]})),sportmonks.getFixturesByDate(date).catch(()=>({ok:false,fixtures:[]}))]);
    let fallback=raw.ok?(raw.data?.events||[]).map(sportsDb.transformEvent):[];
    if(verified.ok)fallback=footballDataOrg.mergeVerifiedScores(fallback,verified.matches);
    fallback=await sportsDb.attachHalftimeScores(fallback);
    const smRows=sm.ok?(sm.fixtures||[]):[];
    let m=smRows.find(x=>String(x.sportmonksId||x.fixtureId)===String(fixtureId))||smRows.find(x=>teamPairMatch(x,homeTeam,awayTeam));
    if(m&&[5,8,9].includes(Number(m.stateId))&&m.homeScore!=null&&m.awayScore!=null)return {source:'sportmonks',match:{...m,statusShort:'FT',isFinished:true},date};
    m=fallback.find(x=>String(x.fixtureId)===String(fixtureId))||fallback.find(x=>teamPairMatch(x,homeTeam,awayTeam));
    if(finalMatch(m))return {source:'fallback',match:m,date};
  }
  // Lower-league/cup fixtures are sometimes removed from TheSportsDB compact
  // day/direct feeds after FT. BSD is already our primary non-SportMonks
  // football source, so use its finished event as the final score fallback.
  const bsdFallback=await resolveBsdFinal(matchDate,fixtureId,homeTeam,awayTeam,providerIds,mappedIds,kickoff);
  if(bsdFallback)return bsdFallback;
  return {source:null,match:null};
}

async function settlePending(userId) {
  // Resolve oldest pending slips first. A newest-first limit can permanently
  // starve older coupons when a user has many pending slips.
  // Keep grading every leg until every match has its own final result.
  // A coupon may already be LOST because one leg lost, while other legs are
  // still pending; those legs must still be graded for the UI/history.
  const coupons=await Coupon.find({userId,$or:[{status:'pending'},{'legs.selection.result':'pending'}]}).sort({createdAt:1}).limit(100);
  for(const coupon of coupons){
    // Migrate/settle legacy one-match coupons created before multi-leg slips.
    if(!coupon.legs?.length){
      if(!coupon.fixtureId || !coupon.matchDate || !(coupon.selections||[]).length) continue;
      const resolved=await canonicalResult(coupon.matchDate,coupon.fixtureId,coupon.homeTeam,coupon.awayTeam,{},coupon.league||'',coupon.kickoff||null);
      const match=resolved.match;
      if(!match)continue;
      let corners=null;
      if(coupon.selections.some(s=>String(s.key||'').startsWith('corners'))){
        const stats=await sportsDb.getEventStatsFormatted(coupon.fixtureId);
        if(stats.available&&stats.stats?.corners)corners=Number(stats.stats.corners.home||0)+Number(stats.stats.corners.away||0);
        if(corners==null&&match?.statistics?.corners){const ch=Number(match.statistics.corners.home),ca=Number(match.statistics.corners.away);if(Number.isFinite(ch)&&Number.isFinite(ca))corners=ch+ca}
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
      if(!match){console.log('[coupons/settle-miss]',JSON.stringify({fixtureId:leg.fixtureId,date:leg.matchDate,home:leg.homeTeam,away:leg.awayTeam}));continue;}
      let corners=null;
      if(leg.selection.key.startsWith('corners')){
        const stats=await sportsDb.getEventStatsFormatted(leg.fixtureId);
        if(stats.available&&stats.stats?.corners)corners=Number(stats.stats.corners.home||0)+Number(stats.stats.corners.away||0);
        if(corners==null&&match?.statistics?.corners){const ch=Number(match.statistics.corners.home),ca=Number(match.statistics.corners.away);if(Number.isFinite(ch)&&Number.isFinite(ca))corners=ch+ca}
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
  const userIds = await Coupon.distinct('userId', { $or:[{status:'pending'},{'legs.selection.result':'pending'}] });
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
      providerIds:{sportsdb:String(leg.providerIds?.sportsdb||leg.fixtureId||''),sportmonks:String(leg.providerIds?.sportmonks||''),bsd:String(leg.providerIds?.bsd||''),footballData:String(leg.providerIds?.footballData||'')}};
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
    const coupons=await Coupon.find({userId:req.user.userId,$or:[{status:'pending'},{'legs.selection.result':'pending'}]}).sort({createdAt:1}).limit(250);
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
    // Then refresh unresolved slips from canonical providers once.
    await settlePending(req.user.userId);
    res.json({ok:true,couponsUpdated,selectionsUpdated});
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
