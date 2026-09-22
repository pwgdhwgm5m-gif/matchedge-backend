const FixtureMap=require('../models/FixtureMap');
function norm(v){return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim()}
function canonicalKey(date,home,away){return [String(date||'').slice(0,10),norm(home),norm(away)].join('|')}
async function remember(x){
 if(!x.date||!x.home||!x.away||!x.provider||x.id==null)return null;
 const key=canonicalKey(x.date,x.home,x.away);
 let doc=await FixtureMap.findOne({canonicalKey:key});
 if(!doc)doc=new FixtureMap({canonicalKey:key,kickoffDate:String(x.date).slice(0,10),homeCanonical:norm(x.home),awayCanonical:norm(x.away),aliases:[],providers:[]});
 for(const a of [x.home,x.away,x.providerHome,x.providerAway])if(a&&!doc.aliases.includes(String(a)))doc.aliases.push(String(a));
 const p=doc.providers.find(v=>v.provider===x.provider);
 if(p){p.id=String(x.id);p.homeName=x.providerHome||p.homeName;p.awayName=x.providerAway||p.awayName;p.confidence=x.confidence??1;p.resolvedAt=new Date()}
 else doc.providers.push({provider:x.provider,id:String(x.id),homeName:x.providerHome||'',awayName:x.providerAway||'',confidence:x.confidence??1,resolvedAt:new Date()});
 doc.updatedAt=new Date();await doc.save();return doc;
}
async function lookup(x){const doc=await FixtureMap.findOne({canonicalKey:canonicalKey(x.date,x.home,x.away)}).lean();if(!doc)return null;return x.provider?(doc.providers||[]).find(v=>v.provider===x.provider)||null:doc}
module.exports={norm,canonicalKey,remember,lookup};
