const express=require('express');
const router=express.Router();
const competitions=require('../services/competitionRegistryService');
const bsd=require('../services/bsdService');

router.get('/',async(_req,res)=>{
  const result=await bsd.getLeagueRegistry();
  const mapped=new Map();
  if(result.ok)for(const item of Object.values(result.map||{})){
    const competition=competitions.resolveCompetition({leagueName:item.name,leagueCountry:item.country});
    if(!competition)continue;
    const key=competition.canonicalCompetitionKey;
    const ids=mapped.get(key)||new Set();ids.add(String(item.id));mapped.set(key,ids);
  }
  res.json({source:'verified-registry',bsdRegistryAvailable:!!result.ok,
    competitions:competitions.getCompetitionRegistry().filter(x=>x.visibleInCompetitionFilter).map(x=>{
      const bsdIds=[...(mapped.get(x.canonicalCompetitionKey)||[])];
      return {key:x.canonicalCompetitionKey,name:x.displayName,
        providerIds:{sportmonks:x.providerIds.sportmonks||null,
          bsd:bsdIds.length===1?bsdIds[0]:null,
          sportsdb:x.providerIds.sportsdb||null},
        bsdMapping:bsdIds.length===1?'verified':bsdIds.length>1?'ambiguous':'unavailable'};
    })});
});
module.exports=router;
