const Prediction = require('../models/PredictionSnapshot');
const ModelCalibration = require('../models/ModelCalibration');
const { resolveCompetition } = require('./competitionRegistryService');

const MARKETS = ['home','draw','away','over25','btts'];
const HALF_MARKETS = ['fhHomeScores','fhAwayScores','fhOver05','shHomeScores','shAwayScores','shOver05'];
const ALL_MARKETS = [...MARKETS,...HALF_MARKETS];
const CALIBRATION_VERSION = 'cal-v4-venue-regularized';
const MODEL_VERSION = 'analysis-v4-venue-regularized-2026-09';
// Self-improvement is restricted to well-covered core leagues. Each league
// learns its own calibration only after enough prospective settled samples;
// the shared "all" prior is built from the same trusted league set.
const CORE_KEYS = new Set(['england-premier-league','france-ligue-1','italy-serie-a','spain-la-liga','turkey-super-lig','germany-bundesliga']);
const isCoreLeague=league=>CORE_KEYS.has(resolveCompetition({leagueName:String(league||'')})?.canonicalCompetitionKey);
function calibrationScopes(league) {
  const own = String(league || 'Unknown');
  return isCoreLeague(own) ? [own, 'all'] : [own];
}
let cached = new Map();
let cacheUntil = 0;
const clamp = (x, low, high) => Math.min(high, Math.max(low, x));
function shift(p, offset) {
  const q = clamp(Number(p), .001, .999);
  return 1 / (1 + Math.exp(-(Math.log(q / (1-q)) + offset)));
}
function brier(rows, offset = 0) {
  return rows.reduce((sum, row) => sum + (shift(row.p, offset) - row.y) ** 2, 0) / rows.length;
}
function logLoss(rows, offset = 0) {
  return rows.reduce((sum,row)=>{
    const q=clamp(shift(row.p,offset),.001,.999);
    return sum-(row.y*Math.log(q)+(1-row.y)*Math.log(1-q));
  },0)/rows.length;
}
const MARKET_POLICY = Object.freeze({
  home:{minTrain:50,minValidation:20}, draw:{minTrain:60,minValidation:25}, away:{minTrain:50,minValidation:20},
  over25:{minTrain:45,minValidation:20}, btts:{minTrain:45,minValidation:20},
  fhHomeScores:{minTrain:50,minValidation:20}, fhAwayScores:{minTrain:50,minValidation:20}, fhOver05:{minTrain:55,minValidation:20},
  shHomeScores:{minTrain:50,minValidation:20}, shAwayScores:{minTrain:50,minValidation:20}, shOver05:{minTrain:55,minValidation:20}
});
function requiredSample(market, shared=false) {
  const policy=MARKET_POLICY[market];
  if(!policy)return null;
  return Math.max(Math.ceil((shared?Math.max(80,policy.minTrain):policy.minTrain)/.75),
    Math.ceil(policy.minValidation/.25));
}
async function coverage() {
  const rows=await Prediction.find({status:'settled',modelVersion:MODEL_VERSION})
    .select('league kickoff capturedAt actual rawProbabilities probabilities').lean();
  const counts=new Map();
  for(const row of rows){
    if(!row.kickoff||!row.capturedAt||row.capturedAt>=row.kickoff)continue;
    for(const scope of calibrationScopes(row.league)){
      for(const market of ALL_MARKETS){
        const p=HALF_MARKETS.includes(market)?row.rawProbabilities?.[market]:(row.rawProbabilities?.[market]??row.probabilities?.[market]);
        if(!Number.isFinite(p)||p<=0||p>=1||![0,1].includes(row.actual?.[market]))continue;
        const key=scope+'::'+market;counts.set(key,(counts.get(key)||0)+1);
      }
    }
  }
  return {modelVersion:MODEL_VERSION,calibrationVersion:CALIBRATION_VERSION,
    markets:[...counts].map(([key,n])=>{const index=key.lastIndexOf('::'),league=key.slice(0,index),market=key.slice(index+2);
      const required=requiredSample(market,league==='all');return {league,market,settled:n,required,readiness:n>=required?'eligible-for-holdout-check':'collecting'};
    }).sort((a,b)=>a.league.localeCompare(b.league)||a.market.localeCompare(b.market))};
}
function fit(rows, minTrain = 40, minValidation = 20) {
  const cutoff = Math.floor(rows.length * .75);
  const train = rows.slice(0, cutoff), validation = rows.slice(cutoff);
  if (train.length < minTrain || validation.length < minValidation) return null;
  // Shrink an observed calibration gap toward zero to avoid reacting to noise.
  const actual = train.reduce((n, r) => n + r.y, 0);
  const expected = train.reduce((n, r) => n + r.p, 0);
  const mean = clamp(expected / train.length, .01, .99);
  const corrected = clamp((actual + 24 * mean) / (train.length + 24), .01, .99);
  const offset = clamp(Math.log(corrected / (1-corrected)) - Math.log(mean / (1-mean)), -.35, .35);
  const baseline = brier(validation), adjusted = brier(validation, offset);
  const baselineLL=logLoss(validation), adjustedLL=logLoss(validation,offset);
  return { offset, baseline, adjusted, baselineLL, adjustedLL, trainCount: train.length, validationCount: validation.length,
    active: Math.abs(offset) >= .015 && adjusted + .0005 < baseline && adjustedLL <= baselineLL + .001 };
}
async function retrain() {
  const since = new Date(Date.now() - 365 * 86400000);
  const snapshots = await Prediction.find({
    status:'settled', settledAt:{$gte:since}, capturedAt:{$lt:new Date()},
  }).select('modelVersion league kickoff capturedAt probabilities rawProbabilities actual').sort({ kickoff:1 }).lean();
  // Every competition may learn its own mapping once its prospective sample
  // passes the holdout gates. Only the well-covered core leagues may train the
  // shared fallback, so sparse cup/minor-league data never distorts it.
  const targetSnapshots = snapshots.filter(s => s.modelVersion === MODEL_VERSION);
  const groups = new Map();
  for (const s of targetSnapshots) {
    if (!s.kickoff || !s.capturedAt || s.capturedAt >= s.kickoff) continue;
    for (const market of ALL_MARKETS) {
      // Half-market calibration requires a true pre-calibration probability.
      // Older snapshots did not store it, so skip those rows rather than
      // training on already-calibrated output.
      const isHalf = HALF_MARKETS.includes(market);
      const p = isHalf ? s.rawProbabilities?.[market] : (s.rawProbabilities?.[market] ?? s.probabilities?.[market]);
      const y = s.actual?.[market];
      if (!Number.isFinite(p) || ![0,1].includes(y) || p <= 0 || p >= 1) continue;
      for (const league of calibrationScopes(s.league)) {
        const key = MODEL_VERSION + ':' + league + ':' + market;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ p, y });
      }
    }
  }
  let active = 0;
  for (const [key, rows] of groups) {
    const market = key.slice(key.lastIndexOf(':')+1);
    const prefix = MODEL_VERSION + ':';
    const league = key.startsWith(prefix) ? key.slice(prefix.length, -(market.length+1)) : key.slice(0, -(market.length+1));
    const policy=MARKET_POLICY[market]||{minTrain:50,minValidation:20};
    // Shared calibration requires more evidence than a league-specific mapping;
    // each market still qualifies independently.
    const result = fit(rows, league === 'all' ? Math.max(80,policy.minTrain) : policy.minTrain, policy.minValidation);
    if (!result) continue;
    // Candidate-only promotion: a newly trained mapping must clear the
    // chronological holdout gates. A failed candidate is stored inactive and
    // cannot leak into production through the cache.

    await ModelCalibration.updateOne({key}, {$set:{
      key, league, market, modelVersion:MODEL_VERSION, calibrationVersion:CALIBRATION_VERSION, logitOffset: result.offset, active: result.active,
      trainCount: result.trainCount, validationCount: result.validationCount,
      baselineBrier: result.baseline, adjustedBrier: result.adjusted, baselineLogLoss:result.baselineLL, adjustedLogLoss:result.adjustedLL, trainedAt:new Date(),
    }}, {upsert:true});
    if (result.active) active++;
  }
  cacheUntil = 0;
  return { calibrationVersion:CALIBRATION_VERSION, league:'per-league-with-core-shared-prior', observations:targetSnapshots.length, evaluated:groups.size, active };
}
async function deactivateStaleOrRegressed() {
  // Re-check active mappings against the latest chronological prospective
  // sample. If a mapping no longer improves both calibration metrics, fail
  // closed and let the raw model flow through until a later retrain qualifies.
  const since = new Date(Date.now() - 365 * 86400000);
  const snapshots = await Prediction.find({
    status:'settled', modelVersion:MODEL_VERSION, settledAt:{$gte:since}
  }).select('league kickoff capturedAt probabilities rawProbabilities actual').sort({kickoff:1}).lean();
  const activeRows = await ModelCalibration.find({
    active:true, modelVersion:MODEL_VERSION, calibrationVersion:CALIBRATION_VERSION
  }).lean();
  let deactivated=0;
  for(const row of activeRows){
    const isHalf=HALF_MARKETS.includes(row.market);
    const samples=snapshots.filter(s=>
      s.capturedAt && s.kickoff && s.capturedAt < s.kickoff &&
      (row.league==='all' ? isCoreLeague(s.league) : String(s.league||'')===String(row.league||''))
    ).map(s=>({
      p:isHalf?s.rawProbabilities?.[row.market]:(s.rawProbabilities?.[row.market]??s.probabilities?.[row.market]),
      y:s.actual?.[row.market]
    })).filter(x=>Number.isFinite(x.p)&&[0,1].includes(x.y)&&x.p>0&&x.p<1);
    if(samples.length<80)continue;
    const holdout=samples.slice(Math.floor(samples.length*.75));
    if(holdout.length<20)continue;
    const baseline=brier(holdout),adjusted=brier(holdout,row.logitOffset);
    const baselineLL=logLoss(holdout),adjustedLL=logLoss(holdout,row.logitOffset);
    if(!(adjusted + .0005 < baseline && adjustedLL <= baselineLL + .001)){
      await ModelCalibration.updateOne({_id:row._id},{$set:{active:false}});
      deactivated++;
    }
  }
  if(deactivated)cacheUntil=0;
  return {checked:activeRows.length,deactivated};
}
async function offsets() {
  if (Date.now() < cacheUntil) return cached;
  try {
    const rows = await ModelCalibration.find({active:true, modelVersion:MODEL_VERSION, calibrationVersion:CALIBRATION_VERSION, trainedAt:{$gte:new Date(Date.now()-30*86400000)}}).select('key logitOffset modelVersion').lean();
    cached = new Map(rows.map(row => [row.key, row.logitOffset]));
    cacheUntil = Date.now() + 15*60000;
  } catch (error) {
    console.warn('[model-calibration] Using previous values:', error.message);
    cacheUntil = Date.now() + 60000;
  }
  return cached;
}
async function apply({league, match, goals}) {
  const values = await offsets();
  const lookup = market => values.get(MODEL_VERSION+':' +(league || 'Unknown') + ':' + market) ?? values.get(MODEL_VERSION+':all:' + market) ?? 0;
  const raw = {
    home: match.homeWinProbability / 100, draw: match.drawProbability / 100,
    away: match.awayWinProbability / 100, over25: goals.over25GoalsPercent / 100,
    btts: goals.bttsPercent / 100,
  };
  if (Object.values(raw).some(value => !Number.isFinite(value))) return {match, goals, applied:[]};
  const adjusted = {};
  const applied = [];
  for (const market of MARKETS) {
    const offset = lookup(market);
    adjusted[market] = offset ? shift(raw[market], offset) : raw[market];
    if (offset) applied.push(market);
  }
  // 1X2 is one multinomial family: independently learned class offsets are
  // applied together and renormalized only inside that family. Binary markets
  // (O/U and BTTS) remain completely independent.
  const sum = adjusted.home + adjusted.draw + adjusted.away;
  return {
    match: {
      ...match, homeWinProbability: +(100*adjusted.home/sum).toFixed(1),
      drawProbability: +(100*adjusted.draw/sum).toFixed(1),
      awayWinProbability: +(100*adjusted.away/sum).toFixed(1),
    },
    goals: {
      ...goals, over25GoalsPercent: +(100*adjusted.over25).toFixed(1),
      bttsPercent: +(100*adjusted.btts).toFixed(1),
    },
    applied,
    calibrationVersion:CALIBRATION_VERSION,
    diagnostics:{
      appliedMarkets:[...applied],
      oneXTwoApplied:applied.filter(x=>['home','draw','away'].includes(x)),
      binaryApplied:applied.filter(x=>['over25','btts'].includes(x))
    }
  };
}
async function applyHalf({league, half}) {
  if(!half) return {half,applied:[],calibrationVersion:CALIBRATION_VERSION};
  const values=await offsets();
  const lookup=market=>values.get(MODEL_VERSION+':' +(league||'Unknown')+':'+market) ?? values.get(MODEL_VERSION+':all:'+market) ?? 0;
  const mapping=[
    ['fhHomeScores','firstHalf','homeScores'],['fhAwayScores','firstHalf','awayScores'],['fhOver05','firstHalf','over05'],
    ['shHomeScores','secondHalf','homeScores'],['shAwayScores','secondHalf','awayScores'],['shOver05','secondHalf','over05']
  ];
  const out={...half,firstHalf:{...half.firstHalf},secondHalf:{...half.secondHalf}};
  const applied=[];
  for(const [market,period,key] of mapping){
    const p=Number(out?.[period]?.[key])/100,offset=lookup(market);
    if(!Number.isFinite(p)||!offset)continue;
    out[period][key]=+(100*shift(p,offset)).toFixed(1);applied.push(market);
  }
  return {half:out,applied,calibrationVersion:CALIBRATION_VERSION};
}
module.exports = { fit, shift, calibrationScopes, requiredSample, coverage, retrain, deactivateStaleOrRegressed, apply, applyHalf, MARKET_POLICY, CALIBRATION_VERSION, MODEL_VERSION };
