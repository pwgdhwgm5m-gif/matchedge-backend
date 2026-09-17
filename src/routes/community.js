const express=require('express');
const User=require('../models/User');
const CommunityPick=require('../models/CommunityPick');
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
 const users=await User.find({emailVerified:true}).sort({xp:-1,correctPicks:-1,createdAt:1}).limit(50).lean();
 const leaderboard=users.map((u,i)=>publicUser(u,i+1));
 const me=await getWalletUser(req.user.userId);
 const myPosition=me?await User.countDocuments({xp:{$gt:me.xp||0}})+1:null;
 res.json({leaderboard,me:me?publicUser(me,myPosition):null});
});
router.get('/fixture/:fixtureId',async(req,res)=>{
 const fixtureId=String(req.params.fixtureId);
 const rows=await CommunityPick.aggregate([{$match:{fixtureId}},{$group:{_id:{key:'$key',label:'$label',market:'$market'},count:{$sum:1}}},{$sort:{count:-1}}]);
 const totalUsers=await CommunityPick.distinct('userId',{fixtureId}),totalVotes=rows.reduce((n,r)=>n+r.count,0);
 res.json({fixtureId,totalUsers:totalUsers.length,totalVotes,selections:rows.map(r=>({key:r._id.key,label:r._id.label,market:r._id.market,count:r.count,percent:totalVotes?Math.round((r.count/totalVotes)*100):0}))});
});
module.exports=router;
