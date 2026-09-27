const {normalizeTeamIdentity} = require('./competitionRegistryService');
const {summarizeMatches} = require('./statsService');

// Count historical fixtures only with the ID issued by their own provider.
function verifiedHistory(result, teamName, kickoff) {
  if (!result?.ok) return null;
  const expected=normalizeTeamIdentity(teamName);
  const cutoff=kickoff ? Date.parse(kickoff) : Date.now();
  if(!expected || !Number.isFinite(cutoff)) return null;
  const ids=new Set(),fixtures=[];
  for(const match of result.data?.response||[]){
    const date=Date.parse(match?.fixture?.date||'');
    if(!Number.isFinite(date)||date>=cutoff)continue;
    const side=['home','away'].filter(key=>
      normalizeTeamIdentity(match?.teams?.[key]?.name)===expected && match?.teams?.[key]?.id!=null);
    if(side.length!==1)continue;
    const id=String(match.teams[side[0]].id);
    if(result.teamId!=null && String(result.teamId)!==id)continue;
    ids.add(id);fixtures.push(match);
  }
  if(ids.size!==1)return null;
  const teamId=[...ids][0],played=summarizeMatches(fixtures,teamId).played;
  return played ? {...result,teamId,data:{response:fixtures},verifiedPlayed:played} : null;
}
module.exports={verifiedHistory};
