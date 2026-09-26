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
  return `${league}|${new Date(time).toISOString().slice(0,10)}|${home}|${away}`;
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
  if(p){const home=match.homeTeamId||match.homeId,away=match.awayTeamId||match.awayId;
    if(validId(home)||validId(away))result[p]={home:validId(home)?String(home):null,away:validId(away)?String(away):null};}
  return result;
}
function compatible(a,b) {
  const at=Date.parse(a.kickoff),bt=Date.parse(b.kickoff);
  return Number.isFinite(at)&&Number.isFinite(bt)&&Math.abs(at-bt)<=3*3600000 &&
    Object.entries(idsOf(b)).every(([p,id])=>!a.providerIds?.[p]||String(a.providerIds[p])===id);
}
async function remember(match) {
  const key=keyOf(match);if(!key)return null;
  const incoming={canonicalKey:key,competitionKey:match.canonicalCompetitionKey,kickoff:match.kickoff||match.date,
    home:normalizeTeamIdentity(match.homeTeam),away:normalizeTeamIdentity(match.awayTeam),
    providerIds:idsOf(match),providerTeamIds:teamIdsOf(match)};
  if(!Object.keys(incoming.providerIds).length)return null;
  let existing=cache.get(`provider-identity:${key}`);
  if(!existing&&mongoose.connection.readyState===1)existing=await ProviderIdentity.findOne({canonicalKey:key}).lean();
  if(existing&&!compatible(existing,incoming))return null;
  const merged={...incoming,providerIds:{...(existing?.providerIds||{}),...incoming.providerIds},
    providerTeamIds:{...(existing?.providerTeamIds||{}),...incoming.providerTeamIds}};
  cache.set(`provider-identity:${key}`,merged,24*3600);
  if(mongoose.connection.readyState===1)await ProviderIdentity.updateOne({canonicalKey:key},{$set:{...merged,updatedAt:new Date()}},{upsert:true});
  return merged;
}
async function lookup(match) {
  const key=keyOf(match);if(!key)return null;
  let identity=cache.get(`provider-identity:${key}`);
  if(!identity&&mongoose.connection.readyState===1)identity=await ProviderIdentity.findOne({canonicalKey:key}).lean();
  if(!identity||!compatible(identity,{...match,providerIds:idsOf(match)}))return null;
  cache.set(`provider-identity:${key}`,identity,24*3600);
  return identity;
}
module.exports={keyOf,idsOf,teamIdsOf,remember,lookup};
