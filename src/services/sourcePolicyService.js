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
function isBsdCoreLeague({leagueName,country}={}){
  const n=norm(leagueName), c=norm(country);
  const rules=[
    {names:['premier league'],countries:['england','united kingdom','uk']},
    {names:['la liga','laliga'],countries:['spain']},
    {names:['bundesliga'],countries:['germany']},
    {names:['serie a'],countries:['italy']},
    {names:['ligue 1','ligue one'],countries:['france']},
    {names:['turkish super lig','super lig','süper lig'],countries:['turkey','turkiye']}
  ];
  return rules.some(r=>r.names.some(x=>n===norm(x)) && (!c || r.countries.some(x=>c===norm(x))));
}
function policy(ctx={}){
  const core=resolve(ctx);
  return core ? {
    tier:'sportmonks-primary', sportmonks:true, sportmonksLeagueId:core.sportmonksId,
    primary:'sportmonks', secondary:'bsd',
    fieldFallbacks:{
      xg:['sportmonks','bsd-measured','thesportsdb'],
      shotmap:['sportmonks','bsd'],
      momentum:['sportmonks','bsd'],
      matchStats:['sportmonks','bsd','thesportsdb'],
      lineups:['sportmonks','bsd'],
      h2h:['sportmonks','bsd','thesportsdb'],
      predictions:['socceredge','bsd-comparison'],
      corners:['sportmonks-history','bsd','local-model']
    },
    marketAnchorPrimary:'bsd-consensus', oddsPrimary:'the-odds-api', oddsSecondary:'bsd-consensus', supplemental:['bsd','thesportsdb','football-data'],
    rule:'SportMonks remains first for subscribed league data. For fields SportMonks does not supply, use BSD before legacy fallbacks. BSD consensus is the preferred broad market anchor; The Odds API remains the executable bookmaker-price source for Value/EV because free BSD consensus is not a bettable bookmaker quote. Deduplicate correlated evidence before blending.'
  } : {
    tier:'non-sportmonks', sportmonks:false, sportmonksLeagueId:null,
    primary:'bsd', secondary:'thesportsdb', marketAnchorPrimary:'bsd-consensus', oddsPrimary:'the-odds-api', oddsSecondary:'bsd-consensus', supplemental:['bsd','thesportsdb','football-data'],
    rule:'Outside the six subscribed leagues do not query SportMonks. Use BSD first, then TheSportsDB/Football-Data fallbacks. The Odds API remains primary for verified bookmaker prices until BSD price coverage is validated.'
  };
}
module.exports={SPORTMONKS_PRIMARY,resolve,isBsdCoreLeague,policy};
