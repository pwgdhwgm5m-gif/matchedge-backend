const RANKS=[
 {min:0,name:'Çaylak',icon:'🌱'},{min:100,name:'Analist',icon:'📊'},{min:300,name:'Uzman',icon:'🎯'},{min:700,name:'Usta',icon:'🏆'},{min:1500,name:'Efsane',icon:'👑'}
];
const DAILY_REWARDS=[20,25,30,35,40,45,55];
const COUPON_STAKE=10;
const ALLOWED_STAKES=[10,20,50];
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
const MARKET_MULTIPLIERS={home:1.8,draw:2.8,away:2.1,over25:1.7,under25:1.8,bttsYes:1.7,bttsNo:1.9,cornersOver85:1.8,cornersUnder85:1.8,fhHome:2.2,fhDraw:2.6,fhAway:2.4,shHome:2.1,shDraw:2.5,shAway:2.3,mostGoalsFirst:2.2,mostGoalsEqual:2.8,mostGoalsSecond:1.9};
function gameMultiplier(selection){
 const p=Number(selection?.probability);
 if(Number.isFinite(p)&&p>=5&&p<=95)return Math.max(1.15,Math.min(4,Number((100/p).toFixed(2))));
 return MARKET_MULTIPLIERS[selection?.key]||1.5;
}
function calculatePayout(selections=[],stake=COUPON_STAKE){
 const legs=selections.slice(0,8);let multiplier=1;
 for(const leg of legs)multiplier*=gameMultiplier(leg);
 multiplier=Math.min(50,Math.max(1.15,Number(multiplier.toFixed(2))));
 return {multiplier,payout:Math.floor(stake*multiplier),legMultipliers:legs.map(gameMultiplier)};
}
module.exports={RANKS,DAILY_REWARDS,COUPON_STAKE,ALLOWED_STAKES,rankForXp,dailyState,ensureWallet,calculatePayout,gameMultiplier};
