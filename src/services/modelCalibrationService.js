const Prediction = require('../models/PredictionSnapshot');
const ModelCalibration = require('../models/ModelCalibration');

const MARKETS = ['home','draw','away','over25','btts','fhHomeScores','fhAwayScores','fhOver05','shHomeScores','shAwayScores','shOver05'];
const CALIBRATION_VERSION = 'cal-v2-chronological';
const TARGET_LEAGUE = /(?:turk|türk|super lig|süper lig)/i;
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
  }).select('league kickoff capturedAt probabilities rawProbabilities actual').sort({ kickoff:1 }).lean();
  // Adaptive calibration is intentionally restricted to the prospective Süper Lig ledger.
  const targetSnapshots = snapshots.filter(s => TARGET_LEAGUE.test(String(s.league || '')));
  const groups = new Map();
  for (const s of targetSnapshots) {
    if (!s.kickoff || !s.capturedAt || s.capturedAt >= s.kickoff) continue;
    for (const market of MARKETS) {
      const p = s.rawProbabilities?.[market] ?? s.probabilities?.[market];
      const y = s.actual?.[market];
      if (!Number.isFinite(p) || ![0,1].includes(y) || p <= 0 || p >= 1) continue;
      for (const league of ['all', s.league || 'Unknown']) {
        const key = league + ':' + market;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ p, y });
      }
    }
  }
  let active = 0;
  for (const [key, rows] of groups) {
    const market = key.slice(key.lastIndexOf(':')+1);
    const league = key.slice(0, -(market.length+1));
    const result = fit(rows, league === 'all' ? 60 : 40, 20);
    if (!result) continue;
    await ModelCalibration.updateOne({key}, {$set:{
      key, league, market, calibrationVersion:CALIBRATION_VERSION, logitOffset: result.offset, active: result.active,
      trainCount: result.trainCount, validationCount: result.validationCount,
      baselineBrier: result.baseline, adjustedBrier: result.adjusted, baselineLogLoss:result.baselineLL, adjustedLogLoss:result.adjustedLL, trainedAt:new Date(),
    }}, {upsert:true});
    if (result.active) active++;
  }
  cacheUntil = 0;
  return { calibrationVersion:CALIBRATION_VERSION, league:'Turkish Super Lig', observations:targetSnapshots.length, evaluated:groups.size, active };
}
async function offsets() {
  if (Date.now() < cacheUntil) return cached;
  try {
    const rows = await ModelCalibration.find({active:true, calibrationVersion:CALIBRATION_VERSION, trainedAt:{$gte:new Date(Date.now()-30*86400000)}}).select('key logitOffset').lean();
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
  const lookup = market => values.get((league || 'Unknown') + ':' + market) ?? values.get('all:' + market) ?? 0;
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
  };
}
module.exports = { fit, shift, retrain, apply, CALIBRATION_VERSION };
