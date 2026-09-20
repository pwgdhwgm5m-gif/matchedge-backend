const Prediction = require('../models/PredictionSnapshot');
const sportsDb = require('./sportsDbService');
const footballDataOrg = require('./footballDataOrgService');
const VERSION = 'accuracy-v3-sportmonks-market-evidence-2026-09';
const percent = value => Number.isFinite(Number(value)) ? Math.max(0, Math.min(100, Number(value))) / 100 : null;
function probabilities(a) {
  const m = a.modelOnlyProbabilities || {};
  const g = a.marketProbabilities || {};
  return {
    home: percent(m.homeWinProbability), draw: percent(m.drawProbability),
    away: percent(m.awayWinProbability), over25: percent(g.over25GoalsPercent),
    btts: percent(g.bttsPercent),
  };
}
async function capture(a, fixture) {
  const kickoff = new Date(fixture.kickoff);
  if (!a || !fixture.fixtureId || !fixture.homeTeam || !fixture.awayTeam ||
      !Number.isFinite(kickoff.getTime()) || kickoff <= new Date()) return false;
  const values = probabilities(a);
  if (Object.values(values).some(v => v === null)) return false;
  const result = await Prediction.updateOne(
    { fixtureId: String(fixture.fixtureId), modelVersion: VERSION },
    { $setOnInsert: {
      fixtureId: String(fixture.fixtureId), modelVersion: VERSION, kickoff,
      league: fixture.league || '', homeTeam: fixture.homeTeam, awayTeam: fixture.awayTeam,
      capturedAt: new Date(), homeLambda: a.homeLambda, awayLambda: a.awayLambda,
      dataQualityScore: a.dataQualityScore, probabilities: values,
      sportmonksEvidence: a.sportmonksMarketEvidence || null,
      marketBoardSnapshot: Array.isArray(a.marketBoard?.allMarkets) ? a.marketBoard.allMarkets.map(x => ({ key:x.key, market:x.market, probability:x.probability, score:x.score, sportmonksEvidence:x.sportmonksEvidence, sportmonksEvidenceBonus:x.sportmonksEvidenceBonus })) : null,
      rawProbabilities: a.rawModelProbabilities ? {
        home: percent(a.rawModelProbabilities.homeWinProbability), draw: percent(a.rawModelProbabilities.drawProbability),
        away: percent(a.rawModelProbabilities.awayWinProbability), over25: percent(a.rawMarketProbabilities?.over25GoalsPercent),
        btts: percent(a.rawMarketProbabilities?.bttsPercent),
      } : values,
    } }, { upsert: true });
  return Boolean(result.upsertedCount);
}
function outcomes(m) {
  if (m.homeScore == null || m.awayScore == null) return null;
  const h = Number(m.homeScore), a = Number(m.awayScore);
  if (!Number.isFinite(h) || !Number.isFinite(a)) return null;
  return { home: h > a ? 1 : 0, draw: h === a ? 1 : 0, away: a > h ? 1 : 0,
    over25: h + a > 2 ? 1 : 0, btts: h > 0 && a > 0 ? 1 : 0, homeScore: h, awayScore: a };
}
async function settlePending() {
  const pending = await Prediction.find({ status: 'pending', kickoff: { $lt: new Date() } })
    .sort({ kickoff: 1 }).limit(150).lean();
  const day = (date, offset) => new Date(date.getTime() + offset * 86400000).toISOString().slice(0,10);
  const days = [...new Set(pending.flatMap(p => [-1,0,1].map(n => day(p.kickoff,n))))];
  const found = new Map();
  let settled = 0;
  for (const date of days) {
    const [raw, verified] = await Promise.all([
      sportsDb.getMatchesByDate(date), footballDataOrg.getMatchesByDate(date)]);
    let matches = raw.ok ? (raw.data?.events || []).map(sportsDb.transformEvent) : [];
    if (verified.ok) matches = footballDataOrg.mergeVerifiedScores(matches, verified.matches);
    const byId = new Map(matches.filter(m => m.statusShort === 'FT').map(m => [String(m.fixtureId), m]));
    for (const [id, match] of byId) found.set(id, match);
  }
  for (const p of pending) {
      const match = found.get(p.fixtureId);
      const actual = match && outcomes(match);
      if (!actual) continue;
      const result = await Prediction.updateOne(
        { _id: p._id, status: 'pending' },
        { $set: { status: 'settled', actual, settledAt: new Date() } });
      settled += result.modifiedCount;
    }
  return settled;
}
async function sportmonksBacktest() {
  const predictions = await Prediction.find({ status:'settled', sportmonksEvidence:{ $ne:null } })
    .select('league probabilities actual sportmonksEvidence marketBoardSnapshot kickoff').lean();
  const rows = {};
  const add=(market,baseP,adjustedScore,actual)=>{
    if(!Number.isFinite(baseP)||![0,1].includes(actual)||!Number.isFinite(adjustedScore))return;
    // Ranking bonus is converted to a small probability-equivalent delta solely
    // for offline Brier comparison; production probabilities remain untouched.
    const adjustedP=Math.max(.01,Math.min(.99,baseP+(adjustedScore/72)));
    if(!rows[market]) rows[market]={market,count:0,baseline:0,sportmonks:0,wins:0,losses:0};
    const r=rows[market], b=(baseP-actual)**2, s=(adjustedP-actual)**2;
    r.count++;r.baseline+=b;r.sportmonks+=s;if(s<b)r.wins++;else if(s>b)r.losses++;
  };
  for(const p of predictions){
    const board=Array.isArray(p.marketBoardSnapshot)?p.marketBoardSnapshot:[];
    for(const x of board){
      const bonus=Number(x.sportmonksEvidenceBonus);
      if(!Number.isFinite(bonus)||bonus===0)continue;
      if(x.key==='home') add('1X2-home',p.probabilities?.home,bonus,p.actual?.home);
      else if(x.key==='away') add('1X2-away',p.probabilities?.away,bonus,p.actual?.away);
      else if(x.key==='over25') add('over25',p.probabilities?.over25,bonus,p.actual?.over25);
      else if(x.key==='under25') add('under25',1-p.probabilities?.over25,bonus,1-p.actual?.over25);
      else if(x.key==='bttsYes') add('btts',p.probabilities?.btts,bonus,p.actual?.btts);
      else if(x.key==='bttsNo') add('bttsNo',1-p.probabilities?.btts,bonus,1-p.actual?.btts);
    }
  }
  return { version:VERSION, snapshots:predictions.length, rows:Object.values(rows).map(r=>({
    market:r.market,count:r.count,baselineBrier:+(r.baseline/r.count).toFixed(4),
    sportmonksBrier:+(r.sportmonks/r.count).toFixed(4),
    improvementPercent:+(100*(r.baseline-r.sportmonks)/r.baseline).toFixed(2),
    improved:r.wins,worsened:r.losses
  })) };
}
async function performance() {
  const predictions = await Prediction.find({ status: 'settled' })
    .select('league probabilities actual kickoff').lean();
  const groups = new Map();
  for (const p of predictions) for (const [market, probability] of Object.entries(p.probabilities || {})) {
    const actual = p.actual?.[market];
    if (!Number.isFinite(probability) || ![0,1].includes(actual)) continue;
    for (const key of ['all:'+market, (p.league || 'Unknown')+':'+market]) {
      if (!groups.has(key)) groups.set(key, { league: key.startsWith('all:') ? 'all' : p.league || 'Unknown',
        market, count: 0, brierSum: 0, logLossSum: 0, predictedSum: 0, actualSum: 0, correct: 0 });
      const g = groups.get(key), q = Math.max(1e-6, Math.min(1-1e-6, probability));
      g.count++; g.brierSum += (q-actual)**2;
      g.logLossSum += -(actual*Math.log(q)+(1-actual)*Math.log(1-q));
      g.predictedSum += q; g.actualSum += actual;
      g.correct += (q >= 0.5 ? 1 : 0) === actual ? 1 : 0;
    }
  }
  return { snapshots: predictions.length, rows: [...groups.values()].map(g => ({
    league: g.league, market: g.market, count: g.count,
    accuracy: +(100*g.correct/g.count).toFixed(1),
    brier: +(g.brierSum/g.count).toFixed(4),
    logLoss: +(g.logLossSum/g.count).toFixed(4),
    predictedPercent: +(100*g.predictedSum/g.count).toFixed(1),
    actualPercent: +(100*g.actualSum/g.count).toFixed(1),
  })) };
}
module.exports = { capture, settlePending, performance, sportmonksBacktest, VERSION };
