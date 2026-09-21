const CommunityPick=require('../models/CommunityPick');
const User=require('../models/User');
const sportsDb=require('./sportsDbService');
const footballDataOrg=require('./footballDataOrgService');
const sportmonks=require('./sportmonksService');

function normTeam(v){return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\b(fc|cf|sc|afc|fk|sk|calcio|football|club)\b/g,' ').replace(/[^a-z0-9]+/g,' ').trim()}
function teamPairMatch(m,h,a){const x=normTeam(h),y=normTeam(a),mh=normTeam(m?.homeTeam),ma=normTeam(m?.awayTeam);return !!x&&!!y&&!!mh&&!!ma&&(mh===x||mh.includes(x)||x.includes(mh))&&(ma===y||ma.includes(y)||y.includes(ma))}
function finalMatch(m){const s=String(m?.statusShort||m?.status||'').toUpperCase();return !!m&&(m.isFinished===true||['FT','AET','PEN','AWARDED'].includes(s))&&m.homeScore!=null&&m.awayScore!=null}
async function canonicalResult(date,p){
 const [raw,verified,sm]=await Promise.all([sportsDb.getMatchesByDate(date),footballDataOrg.getMatchesByDate(date),sportmonks.getFixturesByDate(date).catch(()=>({ok:false,fixtures:[]}))]);
 let fallback=raw.ok?(raw.data?.events||[]).map(sportsDb.transformEvent):[];if(verified.ok)fallback=footballDataOrg.mergeVerifiedScores(fallback,verified.matches);fallback=await sportsDb.attachHalftimeScores(fallback);
 const rows=sm.ok?(sm.fixtures||[]):[];let m=rows.find(x=>String(x.sportmonksId||x.fixtureId)===String(p.fixtureId))||rows.find(x=>teamPairMatch(x,p.homeTeam,p.awayTeam));
 if(m&&[5,8,9].includes(Number(m.stateId))&&m.homeScore!=null&&m.awayScore!=null)return m;
 m=fallback.find(x=>String(x.fixtureId)===String(p.fixtureId))||fallback.find(x=>teamPairMatch(x,p.homeTeam,p.awayTeam));return finalMatch(m)?m:null
}
function grade(key,h,a,c,hh,ha){const total=h+a;if(key==='home')return h>a?'won':'lost';if(key==='draw')return h===a?'won':'lost';if(key==='away')return a>h?'won':'lost';if(key==='over25')return total>2.5?'won':'lost';if(key==='under25')return total<2.5?'won':'lost';if(key==='bttsYes')return h>0&&a>0?'won':'lost';if(key==='bttsNo')return h===0||a===0?'won':'lost';if(key==='cornersOver95')return c==null?'void':c>=10?'won':'lost';if(key==='cornersUnder95')return c==null?'void':c<=9?'won':'lost';if(key==='cornersOver85')return c==null?'void':c>=9?'won':'lost';if(key==='cornersUnder85')return c==null?'void':c<=8?'won':'lost';if(hh==null||ha==null)return 'void';const sh=h-hh,sa=a-ha;if(key==='fhHome')return hh>ha?'won':'lost';if(key==='fhDraw')return hh===ha?'won':'lost';if(key==='fhAway')return ha>hh?'won':'lost';if(key==='shHome')return sh>sa?'won':'lost';if(key==='shDraw')return sh===sa?'won':'lost';if(key==='shAway')return sa>sh?'won':'lost';const fg=hh+ha,sg=sh+sa;if(key==='mostGoalsFirst')return fg>sg?'won':'lost';if(key==='mostGoalsEqual')return fg===sg?'won':'lost';if(key==='mostGoalsSecond')return sg>fg?'won':'lost';return 'void'}
async function rebuildUserStats(userId){
 const picks=await CommunityPick.find({userId,verified:true,result:{$in:['won','lost']}}).sort({settledAt:1,createdAt:1}).lean();let won=0,lost=0,cur=0,best=0;for(const p of picks){if(p.result==='won'){won++;cur++;best=Math.max(best,cur)}else{lost++;cur=0}}await User.updateOne({_id:userId},{$set:{correctPicks:won,wrongPicks:lost,currentStreak:cur,bestStreak:best}});return {won,lost,currentStreak:cur,bestStreak:best}}
async function rebuildAllAnalystStats(){await User.updateMany({},{$set:{correctPicks:0,wrongPicks:0,currentStreak:0,bestStreak:0}});const ids=await CommunityPick.distinct('userId',{verified:true,result:{$in:['won','lost']}});for(const id of ids)await rebuildUserStats(id);return ids.length}
async function settlePending(){
 const pending=await CommunityPick.find({verified:true,result:'pending',kickoff:{$ne:null,$lt:new Date(Date.now()-90*60000)}}).sort({kickoff:1}).limit(300);if(!pending.length)return {settled:0,users:0};
 const groups=new Map();for(const p of pending){const date=new Date(p.kickoff).toISOString().slice(0,10),k=date+'|'+p.fixtureId;if(!groups.has(k))groups.set(k,{date,p,picks:[]});groups.get(k).picks.push(p)}
 let settled=0;const touched=new Set();
 for(const g of groups.values()){const m=await canonicalResult(g.date,g.p);if(!m)continue;let corners=null;if(g.picks.some(p=>String(p.key).startsWith('corners'))){try{const st=await sportsDb.getEventStatsFormatted(g.p.fixtureId);if(st.available&&st.stats?.corners)corners=Number(st.stats.corners.home||0)+Number(st.stats.corners.away||0)}catch(_){}}
  const h=Number(m.homeScore),a=Number(m.awayScore),hh=m.halftimeHome==null?null:Number(m.halftimeHome),ha=m.halftimeAway==null?null:Number(m.halftimeAway);
  for(const p of g.picks){p.result=grade(p.key,h,a,corners,hh,ha);p.settledAt=new Date();await p.save();settled++;touched.add(String(p.userId))}
 }
 for(const id of touched)await rebuildUserStats(id);if(settled){try{require('./pushGoalService').checkSmartNotifications().catch(()=>{})}catch(_){}}return {settled,users:touched.size}
}
module.exports={settlePending,rebuildUserStats,rebuildAllAnalystStats,grade};