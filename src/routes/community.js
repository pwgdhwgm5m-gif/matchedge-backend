const express=require('express');
const User=require('../models/User');
const CommunityPick=require('../models/CommunityPick');
const Coupon=require('../models/Coupon');
const MiniLeague=require('../models/MiniLeague');
const {requireAuth}=require('../middleware/authMiddleware');
const {rankForXp,dailyState,ensureWallet}=require('../services/gamificationService');
const router=express.Router();
router.use(requireAuth);

function publicUser(user,position=null){
 const total=(user.correctPicks||0)+(user.wrongPicks||0),rank=rankForXp(user.xp||0);
 return {username:user.username,xp:user.xp||0,edgeCoins:user.edgeCoins||0,correctPicks:user.correctPicks||0,wrongPicks:user.wrongPicks||0,accuracy:total?Math.round((user.correctPicks/total)*100):0,currentStreak:user.currentStreak||0,bestStreak:user.bestStreak||0,totalCoinsWon:user.totalCoinsWon||0,totalCoinsSpent:user.totalCoinsSpent||0,netCoins:(user.totalCoinsWon||0)-(user.totalCoinsSpent||0),rank,position,daily:dailyState(user)};
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
 const users=await User.find({xp:{$gte:100}}).sort({xp:-1,correctPicks:-1,createdAt:1}).limit(50).lean();
 const leaderboard=users.map((u,i)=>publicUser(u,i+1));
 const me=await getWalletUser(req.user.userId);
 const myPosition=me && (me.xp||0)>=100 ? await User.countDocuments({xp:{$gt:me.xp||0}})+1 : null;
 res.json({leaderboard,me:me?publicUser(me,myPosition):null});
});
router.get('/fixture/:fixtureId',async(req,res)=>{
 const fixtureId=String(req.params.fixtureId);
 const rows=await CommunityPick.aggregate([{$match:{fixtureId}},{$group:{_id:{key:'$key',label:'$label',market:'$market'},count:{$sum:1}}},{$sort:{count:-1}}]);
 const totalUsers=await CommunityPick.distinct('userId',{fixtureId}),totalVotes=rows.reduce((n,r)=>n+r.count,0);
 res.json({fixtureId,totalUsers:totalUsers.length,totalVotes,selections:rows.map(r=>({key:r._id.key,label:r._id.label,market:r._id.market,count:r.count,percent:totalVotes?Math.round((r.count/totalVotes)*100):0}))});
});

function weekStart(){const d=new Date();d.setUTCHours(0,0,0,0);const day=d.getUTCDay()||7;d.setUTCDate(d.getUTCDate()-day+1);return d}
router.get('/edge-dna',async(req,res)=>{
 const picks=await CommunityPick.find({userId:req.user.userId,result:{$in:['won','lost']}}).lean();
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
 const settled=coupons.filter(x=>x.status!=='pending'),perfect=settled.filter(x=>x.status==='won'&&(x.legs?.length||0)>=5).length;
 const legs=coupons.reduce((n,x)=>n+(x.legs?.length||0),0),progress={slips:coupons.length,legs,perfect},goals={slips:3,legs:10,perfect:1};
 let user=await getWalletUser(req.user.userId);if(!user)return res.status(404).json({error:'Kullanıcı bulunamadı.'});
 if(user.weeklyChallengeKey!==weekKey){user.weeklyChallengeKey=weekKey;user.weeklyChallengeRewards={slips:false,legs:false,perfect:false};await user.save()}
 const claimed=user.weeklyChallengeRewards||{slips:false,legs:false,perfect:false},earned=[];
 let xp=0,coins=0;
 if(progress.slips>=goals.slips&&!claimed.slips){claimed.slips=true;xp+=20;earned.push({key:'slips',xp:20,coins:0})}
 if(progress.legs>=goals.legs&&!claimed.legs){claimed.legs=true;xp+=30;earned.push({key:'legs',xp:30,coins:0})}
 if(progress.perfect>=goals.perfect&&!claimed.perfect){claimed.perfect=true;xp+=100;coins+=50;earned.push({key:'perfect',xp:100,coins:50})}
 if(earned.length){user.xp=(user.xp||0)+xp;user.edgeCoins=(user.edgeCoins||0)+coins;user.weeklyChallengeRewards=claimed;await user.save()}
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
module.exports=router;
