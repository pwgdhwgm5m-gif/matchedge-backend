const express=require('express');
const User=require('../models/User');
const CommunityPick=require('../models/CommunityPick');
const PredictionSnapshot=require('../models/PredictionSnapshot');
const Coupon=require('../models/Coupon');
const MiniLeague=require('../models/MiniLeague');
const {requireAuth}=require('../middleware/authMiddleware');
const {rankForXp,dailyState,ensureWallet}=require('../services/gamificationService');
const sportmonks=require('../services/sportmonksService');
const bsd=require('../services/bsdService');
const sportsDb=require('../services/sportsDbService');
const router=express.Router();
router.use(requireAuth);
const normFixtureTeam=v=>String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\b(fc|cf|sc|afc|fk|sk|calcio|football|club)\b/g,' ').replace(/[^a-z0-9]+/g,' ').trim();
const sameFixtureTeams=(fixture,home,away)=>{
 const h=normFixtureTeam(home),a=normFixtureTeam(away),fh=normFixtureTeam(fixture?.homeTeam),fa=normFixtureTeam(fixture?.awayTeam);
 return !!h&&!!a&&!!fh&&!!fa&&(fh===h||fh.includes(h)||h.includes(fh))&&(fa===a||fa.includes(a)||a.includes(fa));
};

function analystTier(user){
 const total=(user.correctPicks||0)+(user.wrongPicks||0),accuracy=total?Math.round((user.correctPicks/total)*100):0;
 if(total>=150&&accuracy>=65)return {key:'elite',name:'Elite',color:'#f2c94c'};
 if(total>=75&&accuracy>=60)return {key:'expert',name:'Expert',color:'#9d7cf0'};
 if(total>=30&&accuracy>=55)return {key:'analyst',name:'Analyst',color:'#35c878'};
 if(total>=10)return {key:'scout',name:'Scout',color:'#4da3ff'};
 return {key:'rookie',name:'Rookie',color:'#9aa4b8'};
}
function publicUser(user,position=null){
 const total=(user.correctPicks||0)+(user.wrongPicks||0),rank=rankForXp(user.xp||0);
 return {id:user._id,username:user.username,xp:user.xp||0,edgeCoins:user.edgeCoins||0,correctPicks:user.correctPicks||0,wrongPicks:user.wrongPicks||0,totalPicks:total,accuracy:total?Math.round((user.correctPicks/total)*100):0,currentStreak:user.currentStreak||0,bestStreak:user.bestStreak||0,totalCoinsWon:user.totalCoinsWon||0,totalCoinsSpent:user.totalCoinsSpent||0,netCoins:(user.totalCoinsWon||0)-(user.totalCoinsSpent||0),rank,analystTier:analystTier(user),friendsCount:(user.friends||[]).length,followersCount:(user.followers||[]).length,followingCount:(user.following||[]).length,position,daily:dailyState(user)};
}
async function getWalletUser(id){
 const user=await User.findById(id);if(!user)return null;
 if(ensureWallet(user))await user.save();
 return user;
}
router.get('/me',async(req,res)=>{
 const user=await getWalletUser(req.user.userId);if(!user)return res.status(404).json({error:'Kullanıcı bulunamadı.'});
 const ahead=await User.countDocuments({xp:{$gt:user.xp||0}});
 res.json({profile:publicUser(user,ahead+1)});
});
router.post('/daily-claim',async(req,res)=>{
 const user=await getWalletUser(req.user.userId);if(!user)return res.status(404).json({error:'Kullanıcı bulunamadı.'});
 const state=dailyState(user);if(state.claimedToday)return res.status(409).json({error:'Bugünkü ödülünü zaten topladın.',profile:publicUser(user)});
 const today=new Date();today.setUTCHours(0,0,0,0);
 const updated=await User.findOneAndUpdate(
  {_id:user._id,$or:[{lastDailyClaimAt:null},{lastDailyClaimAt:{$lt:today}}]},
  {$inc:{edgeCoins:state.reward},$set:{dailyLoginStreak:state.nextStreak,lastDailyClaimAt:new Date()}},
  {new:true}
 );
 if(!updated)return res.status(409).json({error:'Bugünkü ödülünü zaten topladın.'});
 res.json({reward:state.reward,message:state.reward+' Edge Coin kazandın!',profile:publicUser(updated)});
});
router.get('/leaderboard',async(req,res)=>{
 const users=await User.find({xp:{$gte:250}}).sort({xp:-1,correctPicks:-1,createdAt:1}).limit(50).lean();
 const leaderboard=users.map((u,i)=>publicUser(u,i+1));
 const me=await getWalletUser(req.user.userId);
 let myPosition=null;if(me&&(me.xp||0)>=250){myPosition=await User.countDocuments({xp:{$gte:250},$or:[{xp:{$gt:me.xp||0}},{xp:me.xp||0,correctPicks:{$gt:me.correctPicks||0}},{xp:me.xp||0,correctPicks:me.correctPicks||0,createdAt:{$lt:me.createdAt}}]})+1;}
 res.json({leaderboard,me:me?publicUser(me,myPosition):null});
});
router.get('/fixture/:fixtureId',async(req,res)=>{
 const fixtureId=String(req.params.fixtureId);
 const rows=await CommunityPick.aggregate([{$match:{fixtureId,verified:true}},{$group:{_id:{key:'$key',label:'$label',market:'$market'},count:{$sum:1}}},{$sort:{count:-1}}]);
 const totalUsers=await CommunityPick.distinct('userId',{fixtureId,verified:true}),totalVotes=rows.reduce((n,r)=>n+r.count,0);
 res.json({fixtureId,totalUsers:totalUsers.length,totalVotes,selections:rows.map(r=>({key:r._id.key,label:r._id.label,market:r._id.market,count:r.count,percent:totalVotes?Math.round((r.count/totalVotes)*100):0}))});
});

function weekStart(){const d=new Date();d.setUTCHours(0,0,0,0);const day=d.getUTCDay()||7;d.setUTCDate(d.getUTCDate()-day+1);return d}
router.get('/edge-dna',async(req,res)=>{
 const picks=await CommunityPick.find({userId:req.user.userId,verified:true,result:{$in:['won','lost']}}).lean();
 const group=(keyFn)=>{const m={};for(const p of picks){const k=keyFn(p)||'Diğer';m[k]??={name:k,won:0,total:0};m[k].total++;if(p.result==='won')m[k].won++}return Object.values(m).map(x=>({...x,accuracy:Math.round(x.won/x.total*100)})).sort((a,b)=>b.accuracy-a.accuracy||b.total-a.total)};
 const market=group(p=>p.market),league=group(p=>p.league);
 const snapshots=require('../models/PredictionSnapshot');const settled=await snapshots.find({status:'settled'}).sort({settledAt:-1}).limit(500).lean();
 let aiWon=0,aiTotal=0;for(const s of settled){const p=s.probabilities||{};const keys=['home','draw','away'];const best=keys.sort((a,b)=>(p[b]||0)-(p[a]||0))[0];const actual=s.outcome?.homeScore>s.outcome?.awayScore?'home':s.outcome?.homeScore<s.outcome?.awayScore?'away':'draw';if(p[best]!=null){aiTotal++;if(best===actual)aiWon++}}
 const userWon=picks.filter(p=>p.result==='won').length;
 res.json({total:picks.length,user:{won:userWon,accuracy:picks.length?Math.round(userWon/picks.length*100):0},ai:{won:aiWon,total:aiTotal,accuracy:aiTotal?Math.round(aiWon/aiTotal*100):0},bestMarkets:market.slice(0,5),bestLeagues:league.slice(0,5)});
});
router.get('/weekly-challenge',async(req,res)=>{
 const start=weekStart(),end=new Date(start.getTime()+7*86400000),weekKey=start.toISOString().slice(0,10);
 const coupons=await Coupon.find({userId:req.user.userId,createdAt:{$gte:start,$lt:end}}).lean();
 const settled=coupons.filter(x=>x.status!=='pending'),perfect=settled.filter(x=>x.status==='won'&&(x.legs?.length||0)>=3).length;
 const legs=coupons.reduce((n,x)=>n+(x.legs?.length||0),0),progress={slips:coupons.length,legs,perfect},goals={slips:3,legs:10,perfect:1};
  let user=await getWalletUser(req.user.userId);if(!user)return res.status(404).json({error:'Kullanıcı bulunamadı.'});
  // Resetting the week is idempotent; each reward is then claimed with a
  // conditional atomic update so two concurrent requests cannot pay twice.
  if(user.weeklyChallengeKey!==weekKey){
    await User.updateOne({_id:user._id,weeklyChallengeKey:{$ne:weekKey}},{$set:{weeklyChallengeKey:weekKey,weeklyChallengeRewards:{slips:false,legs:false,perfect:false}}});
  }
  const earned=[];
  const rewards=[
    {key:'slips',met:progress.slips>=goals.slips,xp:20,coins:0},
    {key:'legs',met:progress.legs>=goals.legs,xp:30,coins:0},
    {key:'perfect',met:progress.perfect>=goals.perfect,xp:100,coins:50},
  ];
  for(const reward of rewards){
    if(!reward.met)continue;
    const claimed=await User.findOneAndUpdate(
      {_id:user._id,weeklyChallengeKey:weekKey,[`weeklyChallengeRewards.${reward.key}`]:{$ne:true}},
      {$inc:{xp:reward.xp,edgeCoins:reward.coins},$set:{[`weeklyChallengeRewards.${reward.key}`]:true}},
      {new:true}
    );
    if(claimed)earned.push({key:reward.key,xp:reward.xp,coins:reward.coins});
  }
  user=await User.findById(user._id);
  const claimed=user.weeklyChallengeRewards||{slips:false,legs:false,perfect:false};
 res.json({startsAt:start,endsAt:end,progress,goals,rewards:{slips:{xp:20,coins:0},legs:{xp:30,coins:0},perfect:{xp:100,coins:50}},claimed,earned,profile:publicUser(user)});
});
router.post('/mini-leagues',async(req,res)=>{
 const name=String(req.body.name||'').trim().slice(0,40);if(name.length<3)return res.status(400).json({error:'Lig adı en az 3 karakter olmalı.'});
 let code;do{code=Math.random().toString(36).slice(2,8).toUpperCase()}while(await MiniLeague.exists({code}));
 const league=await MiniLeague.create({name,code,ownerId:req.user.userId,members:[req.user.userId]});res.status(201).json({league});
});
router.post('/mini-leagues/join',async(req,res)=>{
 const code=String(req.body.code||'').trim().toUpperCase();const league=await MiniLeague.findOneAndUpdate({code},{$addToSet:{members:req.user.userId}},{new:true});
 if(!league)return res.status(404).json({error:'Davet kodu bulunamadı.'});res.json({league});
});
router.get('/mini-leagues',async(req,res)=>{
 const leagues=await MiniLeague.find({members:req.user.userId}).lean(),out=[];
 for(const l of leagues){const users=await User.find({_id:{$in:l.members}}).sort({xp:-1,correctPicks:-1}).lean();out.push({...l,members:users.map((u,i)=>({...publicUser(u,i+1),id:undefined}))})}
 res.json({leagues:out});
});
// Social analyst profiles ----------------------------------------------------
function relation(me,other){
 const oid=String(other._id),mid=String(me._id);
 if((me.friends||[]).some(x=>String(x)===oid))return 'friends';
 if((me.outgoingFriendRequests||[]).some(x=>String(x)===oid))return 'requested';
 if((me.incomingFriendRequests||[]).some(x=>String(x)===oid))return 'incoming';
 return mid===oid?'self':'none';
}
function groupedPerformance(picks,key){
 const map={};for(const p of picks){const k=String(p[key]||'Other');map[k]??={name:k,won:0,total:0};map[k].total++;if(p.result==='won')map[k].won++}
 return Object.values(map).filter(x=>x.total>=3).map(x=>({...x,accuracy:Math.round(x.won/x.total*100)})).sort((a,b)=>b.accuracy-a.accuracy||b.total-a.total);
}
router.get('/users/discover',async(req,res)=>{
 const me=await User.findById(req.user.userId).lean();if(!me)return res.status(404).json({error:'User not found.'});
 const users=await User.find({_id:{$ne:req.user.userId}}).sort({xp:-1,correctPicks:-1,createdAt:-1}).limit(60).lean();
 res.json({users:users.map(u=>({...publicUser(u),relationship:relation(me,u),isFollowing:(me.following||[]).some(x=>String(x)===String(u._id))}))});
});
router.get('/users/search',async(req,res)=>{
 const q=String(req.query.q||'').trim().toLowerCase().slice(0,30);if(q.length<2)return res.json({users:[]});
 const safeQ=q.replace(/[.*+?^$()|[\]{}\\]/g,'\\$&');
 const me=await User.findById(req.user.userId).lean();const users=await User.find({username:{$regex:'^'+safeQ,$options:'i'},_id:{$ne:req.user.userId}}).limit(20).lean();
 res.json({users:users.map(u=>({...publicUser(u),relationship:relation(me,u)}))});
});
router.get('/friends',async(req,res)=>{
 const me=await User.findById(req.user.userId).lean();if(!me)return res.status(404).json({error:'User not found.'});
 const [friends,incoming,outgoing]=await Promise.all([User.find({_id:{$in:me.friends||[]}}).lean(),User.find({_id:{$in:me.incomingFriendRequests||[]}}).lean(),User.find({_id:{$in:me.outgoingFriendRequests||[]}}).lean()]);
 res.json({friends:friends.map(u=>publicUser(u)),requests:incoming.map(u=>publicUser(u)),sentRequests:outgoing.map(u=>publicUser(u))});
});
router.get('/profile/:username',async(req,res)=>{
 const me=await User.findById(req.user.userId).lean(),user=await User.findOne({username:String(req.params.username||'').toLowerCase()}).lean();
 if(!me||!user)return res.status(404).json({error:'Profile not found.'});
 const picks=await CommunityPick.find({userId:user._id,verified:true,result:{$in:['won','lost','pending']}}).sort({createdAt:-1}).limit(250).lean();
 const settled=picks.filter(p=>p.result==='won'||p.result==='lost'),recent=picks.slice(0,20).map(p=>({fixtureId:p.fixtureId,homeTeam:p.homeTeam,awayTeam:p.awayTeam,league:p.league,market:p.market,label:p.label,result:p.result,kickoff:p.kickoff,createdAt:p.createdAt}));
 const bestMarkets=groupedPerformance(settled,'market').slice(0,3),bestLeagues=groupedPerformance(settled,'league').slice(0,3);
 const badges=[...bestMarkets.filter(x=>x.total>=10&&x.accuracy>=60).map(x=>({type:'market',name:x.name+' Expert'})),...bestLeagues.filter(x=>x.total>=10&&x.accuracy>=60).map(x=>({type:'league',name:x.name+' Specialist'}))].slice(0,4);
 res.json({profile:publicUser(user),relationship:relation(me,user),isFollowing:(me.following||[]).some(x=>String(x)===String(user._id)),bestMarkets,bestLeagues,badges,recent});
});
router.post('/friends/:userId/request',async(req,res)=>{
 const mongoose=require('mongoose');if(!mongoose.Types.ObjectId.isValid(req.params.userId)||String(req.params.userId)===String(req.user.userId))return res.status(400).json({error:'Invalid user.'});
 const [me,other]=await Promise.all([User.findById(req.user.userId),User.findById(req.params.userId)]);if(!me||!other)return res.status(404).json({error:'User not found.'});
 if((me.friends||[]).some(x=>String(x)===String(other._id)))return res.json({relationship:'friends'});
 await Promise.all([User.updateOne({_id:me._id},{$addToSet:{outgoingFriendRequests:other._id}}),User.updateOne({_id:other._id},{$addToSet:{incomingFriendRequests:me._id}})]);
 try{const push=require('../services/pushGoalService');await push.sendToUsers([String(other._id)],{type:'friend-request',eventId:'friend-request:'+String(me._id)+':'+String(other._id),title:'👥 New Friend Request',body:'@'+me.username+' sent you a friend request.',url:'/friends.html'});}catch(e){console.warn('[push/friend-request]',e.message)}
 res.json({relationship:'requested'});
});
router.post('/friends/:userId/accept',async(req,res)=>{
 const mongoose=require('mongoose');if(!mongoose.Types.ObjectId.isValid(req.params.userId))return res.status(400).json({error:'Invalid user.'});
 const me=await User.findById(req.user.userId);if(!me||(me.incomingFriendRequests||[]).some(x=>String(x)===String(req.params.userId))===false)return res.status(409).json({error:'Friend request not found.'});
 await Promise.all([User.updateOne({_id:me._id},{$addToSet:{friends:req.params.userId},$pull:{incomingFriendRequests:req.params.userId}}),User.updateOne({_id:req.params.userId},{$addToSet:{friends:me._id},$pull:{outgoingFriendRequests:me._id}})]);res.json({relationship:'friends'});
});
router.delete('/friends/:userId',async(req,res)=>{
 const mongoose=require('mongoose');if(!mongoose.Types.ObjectId.isValid(req.params.userId))return res.status(400).json({error:'Invalid user.'});
 await Promise.all([User.updateOne({_id:req.user.userId},{$pull:{friends:req.params.userId,incomingFriendRequests:req.params.userId,outgoingFriendRequests:req.params.userId}}),User.updateOne({_id:req.params.userId},{$pull:{friends:req.user.userId,incomingFriendRequests:req.user.userId,outgoingFriendRequests:req.user.userId}})]);res.json({relationship:'none'});
});
router.post('/follow/:userId',async(req,res)=>{
 const mongoose=require('mongoose');if(!mongoose.Types.ObjectId.isValid(req.params.userId)||String(req.params.userId)===String(req.user.userId))return res.status(400).json({error:'Invalid user.'});
 const other=await User.findById(req.params.userId);if(!other)return res.status(404).json({error:'User not found.'});
 await Promise.all([User.updateOne({_id:req.user.userId},{$addToSet:{following:other._id}}),User.updateOne({_id:other._id},{$addToSet:{followers:req.user.userId}})]);
 res.json({following:true});
});
router.delete('/follow/:userId',async(req,res)=>{
 const mongoose=require('mongoose');if(!mongoose.Types.ObjectId.isValid(req.params.userId))return res.status(400).json({error:'Invalid user.'});
 await Promise.all([User.updateOne({_id:req.user.userId},{$pull:{following:req.params.userId}}),User.updateOne({_id:req.params.userId},{$pull:{followers:req.user.userId}})]);
 res.json({following:false});
});
router.get('/fixture/:fixtureId/consensus',async(req,res)=>{
 const fixtureId=String(req.params.fixtureId),picks=await CommunityPick.find({fixtureId,verified:true}).lean();
 const ids=[...new Set(picks.map(p=>String(p.userId)))],users=await User.find({_id:{$in:ids}}).lean(),byId=new Map(users.map(u=>[String(u._id),u]));
 const rows={},marketTotals={};
 for(const p of picks){const market=String(p.market||'Other'),k=p.key||p.label,u=byId.get(String(p.userId)),expert=!!u&&['expert','elite'].includes(analystTier(u).key);marketTotals[market]??={community:0,experts:0};marketTotals[market].community++;if(expert)marketTotals[market].experts++;rows[k]??={key:k,label:p.label,market,community:0,experts:0};rows[k].community++;if(expert)rows[k].experts++}
 res.json({fixtureId,totalUsers:ids.length,selections:Object.values(rows).map(x=>{const t=marketTotals[x.market]||{};return {...x,communityPercent:t.community?Math.round(x.community/t.community*100):0,expertPercent:t.experts?Math.round(x.experts/t.experts*100):0,communityMarketTotal:t.community||0,expertMarketTotal:t.experts||0}})});
});

router.get('/feed/arena',async(req,res)=>{
 const picks=await CommunityPick.find({verified:true}).sort({createdAt:-1}).limit(40).lean(),ids=[...new Set(picks.map(p=>String(p.userId)))],users=await User.find({_id:{$in:ids}}).lean(),byId=new Map(users.map(u=>[String(u._id),u]));
 res.json({items:picks.map(p=>{const u=byId.get(String(p.userId));return {id:p._id,fixtureId:p.fixtureId,homeTeam:p.homeTeam,awayTeam:p.awayTeam,league:p.league,market:p.market,label:p.label,result:p.result,kickoff:p.kickoff,createdAt:p.createdAt,user:u?publicUser(u):null}}).filter(x=>x.user)});
});
router.get('/feed/following',async(req,res)=>{
 const me=await User.findById(req.user.userId).lean();if(!me)return res.status(404).json({error:'User not found.'});
 const ids=me.following||[];if(!ids.length)return res.json({items:[]});
 const picks=await CommunityPick.find({userId:{$in:ids},verified:true}).sort({createdAt:-1}).limit(60).lean(),users=await User.find({_id:{$in:ids}}).lean(),byId=new Map(users.map(u=>[String(u._id),u]));
 res.json({items:picks.map(p=>{const u=byId.get(String(p.userId));return {id:p._id,fixtureId:p.fixtureId,homeTeam:p.homeTeam,awayTeam:p.awayTeam,league:p.league,market:p.market,label:p.label,result:p.result,kickoff:p.kickoff,createdAt:p.createdAt,user:u?publicUser(u):null}})});
});
router.get('/verified-picks/:fixtureId/mine',async(req,res)=>{const picks=await CommunityPick.find({userId:req.user.userId,fixtureId:String(req.params.fixtureId),verified:true}).lean();res.json({picks:picks.map(p=>({key:p.key,market:p.market,label:p.label,result:p.result,createdAt:p.createdAt}))})});
router.post('/verified-picks',async(req,res)=>{
  const b=req.body||{},fixtureId=String(b.fixtureId||''),requestedKey=String(b.key||'');
  if(!fixtureId||!requestedKey)return res.status(400).json({error:'Missing pick data.'});
  const snapshots=await PredictionSnapshot.find({fixtureId,status:'pending',canonicalFixtureKey:{$ne:null}}).sort({capturedAt:-1}).limit(10).lean();
  const fixtureKeys=[...new Set(snapshots.map(x=>x.canonicalFixtureKey).filter(Boolean))];
  if(fixtureKeys.length!==1)return res.status(409).json({error:'Canonical fixture identity is ambiguous or unavailable.'});
  const snapshot=snapshots[0],canonicalFixtureKey=String(snapshot.canonicalFixtureKey);
  if(!snapshot||!snapshot.kickoff)return res.status(409).json({error:'No canonical prediction snapshot is available. Pick was not locked.'});
  const existing=await CommunityPick.findOne({userId:req.user.userId,canonicalFixtureKey,key:requestedKey,verified:true}).lean();if(existing)return res.json({pick:existing,locked:true});
  if(!['PICK','VALUE'].includes(snapshot.publicationStatus))return res.status(409).json({error:'This match has no published prediction selection.'});
  const candidates=(snapshot.publishedSelections||[]).filter(Boolean);
  const canonical=candidates.find(p=>String(p.key)===requestedKey);
  if(!canonical||!canonical.market||!canonical.label)return res.status(409).json({error:'Selection is not present in the canonical prediction snapshot.'});
  const key=String(canonical.key),market=String(canonical.market).slice(0,40),label=String(canonical.label).slice(0,60);
  const homeTeam=String(snapshot.homeTeam||'').slice(0,80),awayTeam=String(snapshot.awayTeam||'').slice(0,80),league=String(snapshot.league||'').slice(0,80);
  if(!homeTeam||!awayTeam)return res.status(409).json({error:'Canonical fixture data is incomplete.'});
 let fixture=null;
 const canonicalProvider=String(snapshot.canonicalProvider||''),canonicalId=String(snapshot.providerIds?.[canonicalProvider]||'');
 if(!['sportmonks','bsd','sportsdb'].includes(canonicalProvider)||!canonicalId)return res.status(409).json({error:'Canonical fixture identity is unavailable.'});
 if(canonicalProvider==='sportmonks'){
  const direct=await sportmonks.request('/fixtures/'+encodeURIComponent(canonicalId),{include:'participants'}).catch(()=>({ok:false}));
  if(direct.ok&&direct.data?.data)fixture=sportmonks.transformFixture(direct.data.data);
 }else if(canonicalProvider==='bsd'){
  const direct=await bsd.getEventById(canonicalId).catch(()=>({available:false}));
  if(direct.available)fixture=direct.match;
 }else{
  const direct=await sportsDb.getEventById(canonicalId).catch(()=>({ok:false}));
  const event=direct.ok?(direct.data?.events||[])[0]:null;
  if(event)fixture=sportsDb.transformEvent(event);
 }
 if(fixture&&!sameFixtureTeams(fixture,homeTeam,awayTeam))fixture=null;
  if(!fixture||!fixture.kickoff)return res.status(409).json({error:'Fixture kickoff could not be verified. Pick was not locked.'});
  const kickoff=new Date(snapshot.kickoff),providerKickoff=new Date(fixture.kickoff);
  if(Number.isNaN(kickoff.getTime())||Number.isNaN(providerKickoff.getTime())||Math.abs(kickoff-providerKickoff)>15*60*1000||kickoff.getTime()<=Date.now()||fixture.isLive||fixture.statusShort==='FT')return res.status(409).json({error:'Started matches cannot receive new verified picks.'});
  const conflicting=await CommunityPick.findOne({userId:req.user.userId,canonicalFixtureKey,verified:true}).lean();if(conflicting)return res.status(409).json({error:'Only one MY PICK can be locked per match.',code:'MY_PICK_FIXTURE_LOCKED',pick:{key:conflicting.key,market:conflicting.market,label:conflicting.label,result:conflicting.result}});
  const pick=await CommunityPick.create({userId:req.user.userId,fixtureId,key,market,label,homeTeam,awayTeam,league,kickoff,
   canonicalFixtureKey,canonicalProvider,providerIds:{[canonicalProvider]:canonicalId},result:'pending',verified:true,lockedAt:new Date(),source:String(b.source)==='match-room'?'match-room':'analysis'});
 try{require('../services/pushGoalService').checkSmartNotifications().catch(()=>{})}catch(_){}
 res.status(201).json({pick,locked:true});
});

module.exports=router;
