const express=require('express');
const User=require('../models/User');
const CommunityPick=require('../models/CommunityPick');
const {requireAuth}=require('../middleware/authMiddleware');
const {rankForXp}=require('../services/gamificationService');
const router=express.Router();
router.use(requireAuth);

function publicUser(user,position=null){
 const total=(user.correctPicks||0)+(user.wrongPicks||0);
 const rank=rankForXp(user.xp||0);
 return {username:user.username,xp:user.xp||0,edgeCoins:user.edgeCoins||0,correctPicks:user.correctPicks||0,wrongPicks:user.wrongPicks||0,accuracy:total?Math.round((user.correctPicks/total)*100):0,currentStreak:user.currentStreak||0,bestStreak:user.bestStreak||0,rank,position};
}

router.get('/me',async(req,res)=>{
 const user=await User.findById(req.user.userId).lean();
 if(!user)return res.status(404).json({error:'Kullanıcı bulunamadı.'});
 const ahead=await User.countDocuments({xp:{$gt:user.xp||0}});
 res.json({profile:publicUser(user,ahead+1)});
});

router.get('/leaderboard',async(req,res)=>{
 const users=await User.find({emailVerified:true}).sort({xp:-1,correctPicks:-1,createdAt:1}).limit(50).lean();
 const leaderboard=users.map((u,i)=>publicUser(u,i+1));
 const me=await User.findById(req.user.userId).lean();
 const myPosition=me?await User.countDocuments({xp:{$gt:me.xp||0}})+1:null;
 res.json({leaderboard,me:me?publicUser(me,myPosition):null});
});

router.get('/fixture/:fixtureId',async(req,res)=>{
 const fixtureId=String(req.params.fixtureId);
 const rows=await CommunityPick.aggregate([
  {$match:{fixtureId}},
  {$group:{_id:{key:'$key',label:'$label',market:'$market'},count:{$sum:1}}},
  {$sort:{count:-1}}
 ]);
 const totalUsers=await CommunityPick.distinct('userId',{fixtureId});
 const totalVotes=rows.reduce((n,r)=>n+r.count,0);
 res.json({fixtureId,totalUsers:totalUsers.length,totalVotes,selections:rows.map(r=>({key:r._id.key,label:r._id.label,market:r._id.market,count:r.count,percent:totalVotes?Math.round((r.count/totalVotes)*100):0}))});
});

module.exports=router;
