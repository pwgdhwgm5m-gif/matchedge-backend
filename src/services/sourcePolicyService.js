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

const PROVIDER_CHAIN = Object.freeze({
  subscribed: Object.freeze(['sportmonks','bsd','thesportsdb']),
  other: Object.freeze(['bsd','thesportsdb'])
});
function providerChain(ctx={}){
  return resolve(ctx) ? [...PROVIDER_CHAIN.subscribed] : [...PROVIDER_CHAIN.other];
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
function fieldRouting(ctx={}){
 const core=resolve(ctx);
 return Object.freeze({
  fixture:core?['sportmonks','bsd','thesportsdb']:['bsd','thesportsdb','5dollarfootball'],
  result:core?['sportmonks','bsd','thesportsdb']:['bsd','thesportsdb','5dollarfootball'],
  xg:core?['sportmonks','bsd-measured','live-estimate']:['bsd-measured','live-estimate'],
  livePressure:core?['sportmonks','5dollarfootball','bsd','thesportsdb']:['5dollarfootball','bsd','thesportsdb'],
  shots:core?['sportmonks','5dollarfootball','bsd','thesportsdb']:['5dollarfootball','bsd','thesportsdb'],
  possession:core?['sportmonks','5dollarfootball','bsd','thesportsdb']:['5dollarfootball','bsd','thesportsdb'],
  timeline:core?['sportmonks','5dollarfootball','bsd','thesportsdb']:['bsd','5dollarfootball','thesportsdb'],
  lineups:core?['sportmonks','thesportsdb']:['thesportsdb'],
  playerXg:core?['sportmonks']:[],
  cornersCards:core?['sportmonks','5dollarfootball','bsd']:['5dollarfootball','bsd','thesportsdb'],
  executableOdds:['5dollarfootball'],
  marketMovement:['5dollarfootball'],
  historicalOdds:['5dollarfootball','socceredge-ledger'],
  h2h:core?['sportmonks','bsd','thesportsdb']:['bsd','thesportsdb'],
  form:core?['sportmonks','bsd','thesportsdb']:['bsd','thesportsdb']
 });
}
function policy(ctx={}){
  const core=resolve(ctx),fields=fieldRouting(ctx);
  return core ? {
    tier:'sportmonks-primary', sportmonks:true, sportmonksLeagueId:core.sportmonksId,
    primary:'sportmonks', secondary:'bsd', fieldFallbacks:fields,
    marketAnchorPrimary:'5dollarfootball', oddsPrimary:'5dollarfootball', oddsSecondary:'bsd-consensus', supplemental:['bsd','5dollarfootball','thesportsdb','football-data'],
    rule:'Canonical fixtures remain SportMonks-first in the six subscribed leagues. Routing is field-specific: SportMonks owns premium football intelligence/xG, 5Dollar owns executable odds and market movement and supplements live pressure, BSD owns broad non-core coverage/results, SportsDB is fallback. Correlated evidence is deduplicated before blending.'
  } : {
    tier:'non-sportmonks', sportmonks:false, sportmonksLeagueId:null,
    primary:'bsd', secondary:'thesportsdb', fieldFallbacks:fields,
    marketAnchorPrimary:'5dollarfootball', oddsPrimary:'5dollarfootball', oddsSecondary:'bsd-consensus', supplemental:['5dollarfootball','bsd','thesportsdb','football-data'],
    rule:'Outside the six subscribed leagues BSD remains canonical fixture/result owner. 5Dollar is first for executable odds/market movement and first supplemental source for live pressure/shots/possession; SportsDB remains coverage fallback.'
  };
}

module.exports={SPORTMONKS_PRIMARY,PROVIDER_CHAIN,providerChain,ODDS_KEYS_BY_COMPETITION,oddsSportKeyForCompetition,resolve,isBsdCoreLeague,fieldRouting,policy};
