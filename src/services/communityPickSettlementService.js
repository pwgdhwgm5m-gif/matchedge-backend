const CommunityPick=require('../models/CommunityPick');
const User=require('../models/User');
const sportsDb=require('./sportsDbService');
const footballDataOrg=require('./footballDataOrgService');
const sportmonks=require('./sportmonksService');
const bsd=require('./bsdService');
const HALFTIME_GRACE_MS=6*60*60*1000;

function normTeam(v){return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\b(fc|cf|sc|afc|fk|sk|calcio|football|club)\b/g,' ').replace(/[^a-z0-9]+/g,' ').trim()}
function teamPairMatch(m,h,a){const x=normTeam(h),y=normTeam(a),mh=normTeam(m?.homeTeam),ma=normTeam(m?.awayTeam);return !!x&&!!y&&!!mh&&!!ma&&(mh===x||mh.includes(x)||x.includes(mh))&&(ma===y||ma.includes(y)||y.includes(ma))}
function finalMatch(m){const s=String(m?.statusShort||m?.status||'').toUpperCase();return !!m&&(m.isFinished===true||['FT','AET','PEN','AWARDED'].includes(s))&&m.homeScore!=null&&m.awayScore!=null}
function identityMatch(m,p){const a=new Date(m?.kickoff||m?.date||0).getTime(),b=new Date(p?.kickoff||0).getTime();return teamPairMatch(m,p.homeTeam,p.awayTeam)&&Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=6*60*60*1000}
async function canonicalResult(date,p){
  const provider=String(p.canonicalProvider||''),providerId=String(p.providerIds?.[provider]||'');
  if(provider&&providerId){
    let match=null;
    if(provider==='bsd'){
      const direct=await bsd.getEventById(providerId).catch(()=>({available:false}));
      match=direct?.available?direct.match:null;
    }else if(provider==='sportmonks'){
      const direct=await sportmonks.request('/fixtures/'+encodeURIComponent(providerId),{include:'participants;scores;periods'}).catch(()=>({ok:false}));
      match=direct.ok&&direct.data?.data?sportmonks.transformFixture(direct.data.data):null;
    }else if(provider==='sportsdb'){
      const direct=await sportsDb.getEventById(providerId).catch(()=>({ok:false}));
      const event=direct.ok?(direct.data?.events||[])[0]:null;
      match=event?sportsDb.transformEvent(event):null;
      if(match)match=(await sportsDb.attachHalftimeScores([match]))[0]||match;
    }
    return match&&identityMatch(match,p)&&finalMatch(match)?match:null;
  }
  if(provider)return null;
  // Legacy records without a provider namespace are matched only by teams and
  // kickoff; numeric fixture IDs can collide across providers.
 const base=new Date(date+'T12:00:00Z'),dates=[-1,0,1].map(n=>new Date(base.getTime()+n*86400000).toISOString().slice(0,10));
  for(const day of dates){
   const [raw,verified,sm,bsdRows]=await Promise.all([sportsDb.getMatchesByDate(day).catch(()=>({ok:false})),footballDataOrg.getMatchesByDate(day).catch(()=>({ok:false,matches:[]})),sportmonks.getFixturesByDate(day).catch(()=>({ok:false,fixtures:[]})),bsd.getRawFinalMatchesForDate(day).catch(()=>({ok:false,matches:[]}))]);
  let fallback=raw.ok?(raw.data?.events||[]).map(sportsDb.transformEvent):[];if(verified.ok)fallback=footballDataOrg.mergeVerifiedScores(fallback,verified.matches);fallback=await sportsDb.attachHalftimeScores(fallback);
   const rows=sm.ok?(sm.fixtures||[]):[],bsdMatches=bsdRows.ok?(bsdRows.matches||[]):[];
    let m=rows.find(x=>identityMatch(x,p))||bsdMatches.find(x=>identityMatch(x,p));
   if(m&&(( [5,8,9,17].includes(Number(m.stateId)))||finalMatch(m))&&m.homeScore!=null&&m.awayScore!=null)return m;
   m=fallback.find(x=>identityMatch(x,p));if(finalMatch(m))return m;
 }
 return null
}
function grade(key,h,a,c,hh,ha){const total=h+a;if(key==='home')return h>a?'won':'lost';if(key==='draw')return h===a?'won':'lost';if(key==='away')return a>h?'won':'lost';if(key==='over25')return total>2.5?'won':'lost';if(key==='under25')return total<2.5?'won':'lost';if(key==='bttsYes')return h>0&&a>0?'won':'lost';if(key==='bttsNo')return h===0||a===0?'won':'lost';if(key==='cornersOver95')return c==null?'void':c>=10?'won':'lost';if(key==='cornersUnder95')return c==null?'void':c<=9?'won':'lost';if(key==='cornersOver85')return c==null?'void':c>=9?'won':'lost';if(key==='cornersUnder85')return c==null?'void':c<=8?'won':'lost';if(hh==null||ha==null)return 'void';const sh=h-hh,sa=a-ha;if(key==='fhHome')return hh>ha?'won':'lost';if(key==='fhDraw')return hh===ha?'won':'lost';if(key==='fhAway')return ha>hh?'won':'lost';if(key==='shHome')return sh>sa?'won':'lost';if(key==='shDraw')return sh===sa?'won':'lost';if(key==='shAway')return sa>sh?'won':'lost';const fg=hh+ha,sg=sh+sa;if(key==='mostGoalsFirst')return fg>sg?'won':'lost';if(key==='mostGoalsEqual')return fg===sg?'won':'lost';if(key==='mostGoalsSecond')return sg>fg?'won':'lost';return 'void'}
async function rebuildUserStats(userId){
 const picks=await CommunityPick.find({userId,verified:true,result:{$in:['won','lost']}}).sort({settledAt:1,createdAt:1}).lean();let won=0,lost=0,cur=0,best=0;for(const p of picks){if(p.result==='won'){won++;cur++;best=Math.max(best,cur)}else{lost++;cur=0}}await User.updateOne({_id:userId},{$set:{correctPicks:won,wrongPicks:lost,currentStreak:cur,bestStreak:best}});return {won,lost,currentStreak:cur,bestStreak:best}}
async function rebuildAllAnalystStats(){await User.updateMany({},{$set:{correctPicks:0,wrongPicks:0,currentStreak:0,bestStreak:0}});const ids=await CommunityPick.distinct('userId',{verified:true,result:{$in:['won','lost']}});for(const id of ids)await rebuildUserStats(id);return ids.length}
async function settlePending(){
 const pending=await CommunityPick.find({verified:true,result:'pending',kickoff:{$ne:null,$lt:new Date(Date.now()-90*60000)}}).sort({kickoff:1}).limit(300);if(!pending.length)return {settled:0,users:0};
 const groups=new Map();for(const p of pending){const date=new Date(p.kickoff).toISOString().slice(0,10),k=date+'|'+(p.canonicalFixtureKey||('legacy:'+p.fixtureId));if(!groups.has(k))groups.set(k,{date,p,picks:[]});groups.get(k).picks.push(p)}
 let settled=0;const touched=new Set();
 for(const g of groups.values()){const m=await canonicalResult(g.date,g.p);if(!m)continue;let corners=null;if(g.picks.some(p=>String(p.key).startsWith('corners'))){try{const st=await sportsDb.getEventStatsFormatted(g.p.fixtureId);if(st.available&&st.stats?.corners)corners=Number(st.stats.corners.home||0)+Number(st.stats.corners.away||0)}catch(_){} if(corners==null&&m?.statistics?.corners){const ch=Number(m.statistics.corners.home),ca=Number(m.statistics.corners.away);if(Number.isFinite(ch)&&Number.isFinite(ca))corners=ch+ca}}
  const h=Number(m.homeScore),a=Number(m.awayScore),hh=m.halftimeHome==null?null:Number(m.halftimeHome),ha=m.halftimeAway==null?null:Number(m.halftimeAway);
   for(const p of g.picks){const result=grade(p.key,h,a,corners,hh,ha);const needsCorners=String(p.key||'').startsWith('corners'),needsHalftime=['fhHome','fhDraw','fhAway','fhHomeScores','fhAwayScores','fhOver05','shHome','shDraw','shAway','shHomeScores','shAwayScores','shOver05','mostGoalsFirst','mostGoalsEqual','mostGoalsSecond'].includes(p.key);const graceElapsed=Date.now()-new Date(p.kickoff).getTime()>=HALFTIME_GRACE_MS;if((needsCorners&&corners==null)||(needsHalftime&&(hh==null||ha==null)&&!graceElapsed))continue;const nextResult=needsHalftime&&(hh==null||ha==null)?'void':result;const updated=await CommunityPick.updateOne({_id:p._id,result:'pending'},{$set:{result:nextResult,settledAt:new Date()}});if(updated.modifiedCount){settled++;touched.add(String(p.userId))}}
 }
 for(const id of touched)await rebuildUserStats(id);if(settled){try{require('./pushGoalService').checkSmartNotifications().catch(()=>{})}catch(_){}}return {settled,users:touched.size}
}
module.exports={settlePending,rebuildUserStats,rebuildAllAnalystStats,grade,identityMatch};