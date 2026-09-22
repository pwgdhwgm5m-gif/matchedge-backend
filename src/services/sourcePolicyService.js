// Central provider-routing policy. Keep this list aligned with the paid SportMonks subscription.
const SPORTMONKS_PRIMARY = [
  { key:'premier-league', names:['premier league'], sportmonksId:'8', oddsKey:'soccer_epl' },
  { key:'la-liga', names:['la liga','primera division'], sportmonksId:'564', oddsKey:'soccer_spain_la_liga' },
  { key:'bundesliga', names:['bundesliga'], sportmonksId:'82', oddsKey:'soccer_germany_bundesliga' },
  { key:'serie-a', names:['serie a'], sportmonksId:'384', oddsKey:'soccer_italy_serie_a' },
  { key:'ligue-1', names:['ligue 1','ligue one'], sportmonksId:'301', oddsKey:'soccer_france_ligue_one' },
  { key:'turkish-super-lig', names:['turkish super lig','super lig','süper lig'], sportmonksId:'600', oddsKey:'soccer_turkey_super_league' },
];
const norm=v=>String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
function resolve({leagueName,sportKey}={}){
  const n=norm(leagueName), sk=String(sportKey||'').trim();
  return SPORTMONKS_PRIMARY.find(x=>x.oddsKey===sk||x.names.some(name=>n===norm(name)))||null;
}
function policy(ctx={}){
  const core=resolve(ctx);
  return core ? {
    tier:'sportmonks-primary', sportmonks:true, sportmonksLeagueId:core.sportmonksId,
    primary:'sportmonks', oddsPrimary:'the-odds-api', supplemental:['thesportsdb','football-data'],
    rule:'SportMonks first for subscribed football data; The Odds API is primary for bookmaker prices; supplement missing fields and deduplicate before blending.'
  } : {
    tier:'non-sportmonks', sportmonks:false, sportmonksLeagueId:null,
    primary:'non-sportmonks-provider-chain', oddsPrimary:'the-odds-api', supplemental:['the-odds-api','thesportsdb','football-data'],
    rule:'Do not query SportMonks outside the six subscribed leagues.'
  };
}
module.exports={SPORTMONKS_PRIMARY,resolve,policy};
