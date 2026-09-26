// Central provider-routing policy. Keep this list aligned with the paid SportMonks subscription.
const SPORTMONKS_PRIMARY = [
  { key:'premier-league', names:['premier league','england premier league','english premier league','epl'], sportmonksId:'8', oddsKey:'soccer_epl' },
  { key:'la-liga', names:['la liga','primera division','spain la liga','spanish la liga'], sportmonksId:'564', oddsKey:'soccer_spain_la_liga' },
  { key:'bundesliga', names:['bundesliga','germany bundesliga','german bundesliga'], sportmonksId:'82', oddsKey:'soccer_germany_bundesliga' },
  { key:'serie-a', names:['serie a','italy serie a','italian serie a'], sportmonksId:'384', oddsKey:'soccer_italy_serie_a' },
  { key:'ligue-1', names:['ligue 1','ligue one','france ligue 1','french ligue 1'], sportmonksId:'301', oddsKey:'soccer_france_ligue_one' },
  { key:'turkish-super-lig', names:['turkish super lig','super lig','süper lig','turkey super lig','turkey super league','trendyol super lig'], sportmonksId:'600', oddsKey:'soccer_turkey_super_league' },
];

// Verified The Odds API routing. These keys affect bookmaker-price lookup only;
// they never change canonical fixture/data ownership (including SportMonks).
const ODDS_KEYS_BY_COMPETITION = Object.freeze({
  'england-premier-league':'soccer_epl','spain-la-liga':'soccer_spain_la_liga','italy-serie-a':'soccer_italy_serie_a',
  'germany-bundesliga':'soccer_germany_bundesliga','france-ligue-1':'soccer_france_ligue_one','turkey-super-lig':'soccer_turkey_super_league',
  'portugal-primeira-liga':'soccer_portugal_primeira_liga','netherlands-eredivisie':'soccer_netherlands_eredivisie',
  'greece-super-league':'soccer_greece_super_league','scotland-premiership':'soccer_spl','poland-ekstraklasa':'soccer_poland_ekstraklasa',
  'switzerland-super-league':'soccer_switzerland_superleague','denmark-superliga':'soccer_denmark_superliga',
  'norway-eliteserien':'soccer_norway_eliteserien','sweden-allsvenskan':'soccer_sweden_allsvenskan',
  'russia-premier-league':'soccer_russia_premier_league','finland-veikkausliiga':'soccer_finland_veikkausliiga',
  'ireland-premier-division':'soccer_league_of_ireland','usa-mls':'soccer_usa_mls','japan-j1-league':'soccer_japan_j_league',
  'south-korea-k-league-1':'soccer_korea_kleague1','china-super-league':'soccer_china_superleague',
  'uefa-champions-league':'soccer_uefa_champs_league','uefa-europa-league':'soccer_uefa_europa_league',
  'uefa-conference-league':'soccer_uefa_europa_conference_league','uefa-nations-league':'soccer_uefa_nations_league',
  'england-fa-cup':'soccer_fa_cup'
});
function oddsSportKeyForCompetition(canonicalCompetitionKey){
  return ODDS_KEYS_BY_COMPETITION[String(canonicalCompetitionKey||'').trim()]||null;
}

const norm=v=>String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
function resolve({leagueName,sportKey}={}){
  const n=norm(leagueName), sk=String(sportKey||'').trim();
  // A caller-supplied odds key must never turn an unrelated league into a
  // subscribed SportMonks competition.
  return SPORTMONKS_PRIMARY.find(x=>n ? x.names.some(name=>n===norm(name)) : x.oddsKey===sk)||null;
}
function isBsdCoreLeague({leagueName,country}={}){
  const n=norm(leagueName), c=norm(country);
  const core=resolve({leagueName});
  if(!core)return false;
  const countries={'premier-league':['england','united kingdom','uk'],'la-liga':['spain'],
    bundesliga:['germany'],'serie-a':['italy'],'ligue-1':['france'],
    'turkish-super-lig':['turkey','turkiye']};
  return !c||(countries[core.key]||[]).some(x=>c===norm(x));
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
module.exports={SPORTMONKS_PRIMARY,ODDS_KEYS_BY_COMPETITION,oddsSportKeyForCompetition,resolve,isBsdCoreLeague,policy};
