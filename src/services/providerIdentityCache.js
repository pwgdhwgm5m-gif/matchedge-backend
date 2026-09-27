const mongoose = require('mongoose');
const ProviderIdentity = require('../models/ProviderIdentity');
const cache = require('../utils/cache');
const { normalizeTeamIdentity } = require('./competitionRegistryService');

const provider = value => {
  const v=String(value||'').toLowerCase().replace(/[^a-z]/g,'');
  if(v==='bsd')return 'bsd';
  if(v.startsWith('sportmonk'))return 'sportmonks';
  if(v==='tsdb'||v.startsWith('thesportsdb')||v.startsWith('sportsdb'))return 'sportsdb';
  return null;
};
const validId = value => value != null && String(value).trim() && String(value)!=='0';
function keyOf(match) {
  const time=Date.parse(match?.kickoff||match?.date||'');
  const home=normalizeTeamIdentity(match?.homeTeam),away=normalizeTeamIdentity(match?.awayTeam);
  const league=String(match?.canonicalCompetitionKey||'');
  if(!Number.isFinite(time)||!home||!away||!league||league.startsWith('unmapped:'))return null;
  return `${league}|${new Date(time).toISOString().slice(0,10)}|${home}|${away}|${new Date(time).toISOString().slice(11,16)}`;
}
function idsOf(match) {
  const ids={};
  for(const [name,id] of Object.entries(match?.providerIds||{})) {
    const p=provider(name);if(p&&validId(id))ids[p]=String(id);
  }
  const p=provider(match?.canonicalProvider||match?.source||match?.dataSource);
  if(p&&validId(match?.fixtureId))ids[p]=String(match.fixtureId);
  return ids;
}
function teamIdsOf(match) {
  const result={};
  for(const [name,ids] of Object.entries(match?.providerTeamIds||{})) {
    const p=provider(name);if(p&&ids)result[p]={home:validId(ids.home)?String(ids.home):null,away:validId(ids.away)?String(ids.away):null};
  }
  const p=provider(match?.canonicalProvider||match?.source||match?.dataSource);
  if(p&&!result[p]&&Object.keys(idsOf(match)).length===1){const home=match.homeTeamId||match.homeId,away=match.awayTeamId||match.awayId;
    if(validId(home)||validId(away))result[p]={home:validId(home)?String(home):null,away:validId(away)?String(away):null};}
  return result;
}
function compatible(a,b) {
  const at=Date.parse(a.kickoff),bt=Date.parse(b.kickoff);
  return Number.isFinite(at)&&Number.isFinite(bt)&&Math.abs(at-bt)<=15*60000 &&
    Object.entries(idsOf(b)).every(([p,id])=>!a.providerIds?.[p]||String(a.providerIds[p])===id) &&
    Object.entries(teamIdsOf(b)).every(([p,ids])=>['home','away'].every(side=>
      !ids[side]||!a.providerTeamIds?.[p]?.[side]||String(a.providerTeamIds[p][side])===ids[side]));
}
async function candidates(match,key) {
  const rows=[],seen=new Set();
  const add=row=>{if(row&&!seen.has(row.canonicalKey)){seen.add(row.canonicalKey);rows.push(row)}};
  add(cache.get(`provider-identity:${key}`));
  const prefix=key.slice(0,key.lastIndexOf('|')+1);
  for(const cacheKey of cache.raw.keys())if(cacheKey.startsWith(`provider-identity:${prefix}`))
    add(cache.get(cacheKey));
  if(mongoose.connection.readyState===1){
    const kickoff=new Date(match.kickoff||match.date),window=15*60000;
    const found=await ProviderIdentity.find({competitionKey:match.canonicalCompetitionKey,
      home:normalizeTeamIdentity(match.homeTeam),away:normalizeTeamIdentity(match.awayTeam),
      kickoff:{$gte:new Date(kickoff.getTime()-window),$lte:new Date(kickoff.getTime()+window)}}).limit(10).lean();
    for(const row of found)add(row);
  }
  return rows.filter(row=>Math.abs(Date.parse(row.kickoff)-Date.parse(match.kickoff||match.date))<=15*60000)
    .sort((a,b)=>Math.abs(Date.parse(a.kickoff)-Date.parse(match.kickoff||match.date))-
      Math.abs(Date.parse(b.kickoff)-Date.parse(match.kickoff||match.date)));
}
async function remember(match) {
  const key=keyOf(match);if(!key)return null;
  const incoming={canonicalKey:key,competitionKey:match.canonicalCompetitionKey,kickoff:match.kickoff||match.date,
    home:normalizeTeamIdentity(match.homeTeam),away:normalizeTeamIdentity(match.awayTeam),
    providerIds:idsOf(match),providerTeamIds:teamIdsOf(match)};
  if(!Object.keys(incoming.providerIds).length)return null;
  const nearby=await candidates(match,key);
  if(nearby.length!==1&&nearby.length!==0)return null;
  const existing=nearby[0]||null;
  if(existing&&!compatible(existing,incoming))return null;
  const teamIds={...(existing?.providerTeamIds||{})};
  for(const [p,ids] of Object.entries(incoming.providerTeamIds))teamIds[p]={
    ...(teamIds[p]||{}),...Object.fromEntries(Object.entries(ids).filter(([,id])=>validId(id)))};
  const merged={...incoming,canonicalKey:existing?.canonicalKey||key,
    kickoff:existing?.kickoff||incoming.kickoff,
    providerIds:{...(existing?.providerIds||{}),...incoming.providerIds},
    providerTeamIds:teamIds};
  cache.set(`provider-identity:${key}`,merged,24*3600);
  if(merged.canonicalKey!==key)cache.set(`provider-identity:${merged.canonicalKey}`,merged,24*3600);
  if(mongoose.connection.readyState===1)await ProviderIdentity.updateOne({canonicalKey:merged.canonicalKey},{$set:{...merged,updatedAt:new Date()}},{upsert:true});
  return merged;
}
async function lookup(match) {
  const key=keyOf(match);if(!key)return null;
  const nearby=await candidates(match,key);
  if(nearby.length!==1)return null;
  const identity=nearby[0];
  if(!compatible(identity,{...match,providerIds:idsOf(match)}))return null;
  cache.set(`provider-identity:${key}`,identity,24*3600);
  return identity;
}
module.exports={keyOf,idsOf,teamIdsOf,remember,lookup};
