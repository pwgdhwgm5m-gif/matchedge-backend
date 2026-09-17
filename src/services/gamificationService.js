const RANKS=[
 {min:0,name:'Çaylak',icon:'🌱'},{min:100,name:'Analist',icon:'📊'},{min:300,name:'Uzman',icon:'🎯'},{min:700,name:'Usta',icon:'🏆'},{min:1500,name:'Efsane',icon:'👑'}
];
const DAILY_REWARDS=[3,4,5,6,8,10,15];
const COUPON_STAKE=10;
function rankForXp(xp=0){return [...RANKS].reverse().find(r=>xp>=r.min)||RANKS[0]}
function utcDay(date=new Date()){return Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate())}
function daysBetween(a,b){return Math.round((utcDay(b)-utcDay(a))/86400000)}
function dailyState(user,now=new Date()){
 const last=user.lastDailyClaimAt?new Date(user.lastDailyClaimAt):null;
 const claimedToday=last&&daysBetween(last,now)===0;
 const nextStreak=!last||daysBetween(last,now)>1?1:Math.min((user.dailyLoginStreak||0)+1,7);
 return {claimedToday:Boolean(claimedToday),currentStreak:user.dailyLoginStreak||0,nextStreak,reward:DAILY_REWARDS[nextStreak-1],rewards:DAILY_REWARDS};
}
function ensureWallet(user){
 if((user.walletVersion||0)<1){user.edgeCoins=100;user.walletVersion=1;return true}
 return false;
}
function calculatePayout(selections=[]){
 const legs=selections.slice(0,3);
 let multiplier=1;
 for(const leg of legs){const probability=Math.min(85,Math.max(25,Number(leg.probability)||50));multiplier*=Math.min(3,Math.max(1.2,100/probability))}
 multiplier=Math.min(6,Math.max(1.2,Number(multiplier.toFixed(2))));
 return {multiplier,payout:Math.floor(COUPON_STAKE*multiplier)};
}
module.exports={RANKS,DAILY_REWARDS,COUPON_STAKE,rankForXp,dailyState,ensureWallet,calculatePayout};
