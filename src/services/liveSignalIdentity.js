const {normalizeTeamIdentity}=require('./competitionRegistryService');

function teamKey(name){
  return normalizeTeamIdentity(name)
    .replace(/munchen|munih/g,'munich')
    .replace(/utd/g,'united')
    .replace(/parissg|psg/g,'parissaintgermain');
}
function sameTeam(a,b){
  const x=teamKey(a),y=teamKey(b);
  if(!x||!y)return false;
  if(x===y)return true;
  const short=x.length<y.length?x:y,long=x.length<y.length?y:x;
  return short.length>=6&&short.length/long.length>=.65&&long.includes(short);
}
function sameLiveFixture(a,b){
  const at=Date.parse(a?.kickoff||a?.date||''),bt=Date.parse(b?.kickoff||b?.date||'');
  return Number.isFinite(at)&&Number.isFinite(bt)&&Math.abs(at-bt)<=15*60000 &&
    sameTeam(a.homeTeam||a.home,b.homeTeam||b.home)&&sameTeam(a.awayTeam||a.away,b.awayTeam||b.away);
}
function uniqueLiveFixture(rows,match,project=x=>x){
  const found=(rows||[]).filter(row=>sameLiveFixture(project(row),match));
  return found.length===1?found[0]:null;
}
module.exports={sameTeam,sameLiveFixture,uniqueLiveFixture};
