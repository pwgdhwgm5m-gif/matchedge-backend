const Prediction = require('../models/PredictionSnapshot');
const sportsDb = require('./sportsDbService');
const footballDataOrg = require('./footballDataOrgService');
const sportmonks = require('./sportmonksService');
const bsd = require('./bsdService');
const { providerKey } = require('./liveFixtureIdentity');
const { resolveCompetition } = require('./competitionRegistryService');
const VERSION = 'analysis-v4-venue-regularized-2026-09';
const SELECTION_VERSION = 'top-picks-analysis-value-v3';
const HALFTIME_GRACE_MS = 6 * 60 * 60 * 1000;
const percent = value => Number.isFinite(Number(value)) ? Math.max(0, Math.min(100, Number(value))) / 100 : null;
function probabilities(a) {
  const m = a.modelOnlyProbabilities || {};
  const g = a.marketProbabilities || {};
  return {
    home: percent(m.homeWinProbability), draw: percent(m.drawProbability),
    away: percent(m.awayWinProbability), over25: percent(g.over25GoalsPercent),
    btts: percent(g.bttsPercent),
    fhHomeScores: percent(a.halfMarkets?.firstHalf?.homeScores),
    fhAwayScores: percent(a.halfMarkets?.firstHalf?.awayScores),
    fhOver05: percent(a.halfMarkets?.firstHalf?.over05),
    shHomeScores: percent(a.halfMarkets?.secondHalf?.homeScores),
    shAwayScores: percent(a.halfMarkets?.secondHalf?.awayScores),
    shOver05: percent(a.halfMarkets?.secondHalf?.over05),
  };
}
async function capture(a, fixture) {
  const kickoff = new Date(fixture.kickoff);
  const canonicalProvider=String(fixture.canonicalProvider||'');
  const canonicalId=String(fixture.providerIds?.[canonicalProvider]||'');
  const canonicalFixtureKey=['sportmonks','bsd','sportsdb'].includes(canonicalProvider)&&canonicalId
    ? `${canonicalProvider}:${canonicalId}` : null;
  if (!a || !fixture.fixtureId || !fixture.homeTeam || !fixture.awayTeam ||
      !canonicalFixtureKey || !Number.isFinite(kickoff.getTime()) || kickoff <= new Date()) return false;
  const values = probabilities(a);
  if (Object.values(values).some(v => v === null)) return false;
  const result = await Prediction.updateOne(
    { canonicalFixtureKey, modelVersion: VERSION },
    { $setOnInsert: {
      fixtureId: String(fixture.fixtureId), canonicalFixtureKey, modelVersion: VERSION, calibrationVersion:a.calibrationVersion||null, selectionVersion:SELECTION_VERSION, kickoff,
      league: fixture.league || '', homeTeam: fixture.homeTeam, awayTeam: fixture.awayTeam,
      homeTeamId: fixture.homeTeamId || fixture.homeId || null, awayTeamId: fixture.awayTeamId || fixture.awayId || null,
      canonicalProvider: fixture.canonicalProvider || null,
      providerIds: fixture.providerIds || {},
      publicationStatus: a.premium?.status || 'UNAVAILABLE',
      publishedSelections: ['PICK','VALUE'].includes(a.premium?.status)
        ? (a.marketBoard?.topPredictions||[]).map(x=>({key:x.key,market:x.market,label:x.label,direction:x.direction,probability:x.probability,evidenceLevel:x.evidenceLevel,effectiveSample:x.effectiveSample,evidenceSource:x.evidenceSource,priorUsed:x.priorUsed,strongPickEligible:x.strongPickEligible}))
        : [],
      capturedAt: new Date(), homeLambda: a.homeLambda, awayLambda: a.awayLambda,
      dataQualityScore: a.dataQualityScore, probabilities: values,
      qualityDimensions: a.qualityDimensions || null,
      marketEvidence: a.marketEvidence || null,
      xgProvenance: a.xgProvenance || null,
      bttsDirection: a.bttsDirection || null,
      sportmonksEvidence: a.sportmonksMarketEvidence || null,
      marketBoardSnapshot: Array.isArray(a.marketBoard?.allMarkets) ? a.marketBoard.allMarkets.map(x => ({ key:x.key, market:x.market, label:x.label, direction:x.direction, probability:x.probability, score:x.score, evidenceLevel:x.evidenceLevel,effectiveSample:x.effectiveSample,evidenceSource:x.evidenceSource,priorUsed:x.priorUsed,strongPickEligible:x.strongPickEligible,sportmonksEvidence:x.sportmonksEvidence, sportmonksEvidenceBonus:x.sportmonksEvidenceBonus })) : null,
      strongestPick: a.marketBoard?.best ? { key:a.marketBoard.best.key, market:a.marketBoard.best.market, label:a.marketBoard.best.label, direction:a.marketBoard.best.direction, probability:a.marketBoard.best.probability, score:a.marketBoard.best.score,evidenceLevel:a.marketBoard.best.evidenceLevel,effectiveSample:a.marketBoard.best.effectiveSample,evidenceSource:a.marketBoard.best.evidenceSource,priorUsed:a.marketBoard.best.priorUsed,strongPickEligible:a.marketBoard.best.strongPickEligible } : null,
      topPicksSnapshot: (a.marketBoard?.topPredictions||[]).map(x=>({key:x.key,market:x.market,label:x.label,direction:x.direction,probability:x.probability,odds:x.verifiedOdds,bookmaker:x.bookmaker,oddsFresh:x.oddsFresh===true,marketImpliedProbability:x.marketImpliedProbability,edgePoints:x.edgePoints,expectedValuePercent:x.expectedValuePercent,valueScore:x.valueScore,evidenceLevel:x.evidenceLevel,effectiveSample:x.effectiveSample,evidenceSource:x.evidenceSource,priorUsed:x.priorUsed,strongPickEligible:x.strongPickEligible})),
      // Immutable full response used by the normal analysis screen before kickoff.
      // Live pages render this exact object; they never recompute a pre-match view.
      prematchAnalysisArchive: a,
      rawProbabilities: a.rawModelProbabilities ? {
        home: percent(a.rawModelProbabilities.homeWinProbability), draw: percent(a.rawModelProbabilities.drawProbability),
        away: percent(a.rawModelProbabilities.awayWinProbability), over25: percent(a.rawMarketProbabilities?.over25GoalsPercent),
        btts: percent(a.rawMarketProbabilities?.bttsPercent),
        fhHomeScores: percent(a.rawHalfMarkets?.firstHalf?.homeScores),
        fhAwayScores: percent(a.rawHalfMarkets?.firstHalf?.awayScores),
        fhOver05: percent(a.rawHalfMarkets?.firstHalf?.over05),
        shHomeScores: percent(a.rawHalfMarkets?.secondHalf?.homeScores),
        shAwayScores: percent(a.rawHalfMarkets?.secondHalf?.awayScores),
        shOver05: percent(a.rawHalfMarkets?.secondHalf?.over05),
      } : values,
      // Paired prospective baseline captured at the exact same time/fixture as V3.
      // This avoids comparing different fixture populations across model versions.
      comparisonProbabilities: a.rawModelProbabilities ? {
        home: percent(a.rawModelProbabilities.homeWinProbability), draw: percent(a.rawModelProbabilities.drawProbability),
        away: percent(a.rawModelProbabilities.awayWinProbability), over25: percent(a.rawMarketProbabilities?.over25GoalsPercent),
        btts: percent(a.rawMarketProbabilities?.bttsPercent),
      } : null,
    } }, { upsert: true });
  return Boolean(result.upsertedCount);
}
function outcomes(m, options = {}) {
  if (m.homeScore == null || m.awayScore == null) return null;
  const h = Number(m.homeScore), a = Number(m.awayScore);
  if (!Number.isFinite(h) || !Number.isFinite(a)) return null;
  const out={ home: h > a ? 1 : 0, draw: h === a ? 1 : 0, away: a > h ? 1 : 0,
    over25: h + a > 2 ? 1 : 0, btts: h > 0 && a > 0 ? 1 : 0, homeScore: h, awayScore: a };
  const hh=m.halftimeHome==null||m.halftimeHome===''?null:Number(m.halftimeHome);
  const ha=m.halftimeAway==null||m.halftimeAway===''?null:Number(m.halftimeAway);
  if(!options.halftimeUnavailable&&Number.isFinite(hh)&&Number.isFinite(ha)&&hh>=0&&ha>=0&&hh<=h&&ha<=a){
    out.halftimeHome=hh;out.halftimeAway=ha;
    out.fhHomeScores=hh>0?1:0;out.fhAwayScores=ha>0?1:0;out.fhOver05=hh+ha>0?1:0;
    out.shHomeScores=h-hh>0?1:0;out.shAwayScores=a-ha>0?1:0;out.shOver05=(h-hh)+(a-ha)>0?1:0;
  }
  if (options.halftimeUnavailable) {
    out.settlementStatus = 'ungraded';
    out.ungradedMarkets = ['fhHomeScores','fhAwayScores','fhOver05','shHomeScores','shAwayScores','shOver05'];
    out.settlementReason = 'halftime_data_unavailable_after_grace_period';
  }
  return out;
}
function normTeam(v){return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i').replace(/\b(fc|cf|sc|afc|fk|sk|calcio|football|club)\b/g,' ').replace(/[^a-z0-9]+/g,' ').trim()}
function ledgerTeamPairMatch(m,p){const h=normTeam(p.homeTeam),a=normTeam(p.awayTeam),mh=normTeam(m?.homeTeam),ma=normTeam(m?.awayTeam);return !!h&&!!a&&!!mh&&!!ma&&(mh===h||mh.includes(h)||h.includes(mh))&&(ma===a||ma.includes(a)||a.includes(ma))}
function ledgerFinal(m){const s=String(m?.statusShort||m?.status||'').toUpperCase();return !!m&&(m.isFinished===true||['FT','AET','PEN','AWARDED'].includes(s)||[5,8,9].includes(Number(m.stateId)))&&m.homeScore!=null&&m.awayScore!=null}
function providerIdFor(p, provider) {
  return String(p?.providerIds?.[provider] || p?.[`${provider}Id`] || '').trim() || null;
}
function kickoffClose(m, p) {
  const a = new Date(m?.kickoff || m?.date || 0).getTime();
  const b = new Date(p?.kickoff || 0).getTime();
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 6 * 60 * 60 * 1000;
}
function resultIdentityMatches(m,p){
  if(!ledgerTeamPairMatch(m,p)||!kickoffClose(m,p))return false;
  const expected=resolveCompetition({leagueName:p.league});
  const actual=resolveCompetition({leagueName:m?.league||m?.leagueName});
  return !(expected&&actual&&expected.canonicalCompetitionKey!==actual.canonicalCompetitionKey);
}
function exactProviderMatch(m, p, provider) {
  const id = providerIdFor(p, provider);
  if (!id) return false;
  if (providerKey(m?.canonicalProvider||m?.source||m?.dataSource)!==provider)return false;
  return String(m?.providerIds?.[provider] || m?.[`${provider}Id`] ||
    m?.[`${provider}FixtureId`] || m?.fixtureId || m?.id || '') === id;
}
async function directCanonicalResult(p) {
  const bsdId = providerIdFor(p, 'bsd') || (p.canonicalProvider === 'bsd' ? String(p.fixtureId) : null);
  if (bsdId) {
    const r = await bsd.getEventById(bsdId).catch(() => ({ available: false }));
    if (r?.available && resultIdentityMatches(r.match,p) && ledgerFinal(r.match))
      return { match: { ...r.match, canonicalProvider:'bsd' } };
  }
  const smId = providerIdFor(p, 'sportmonks') || (p.canonicalProvider === 'sportmonks' ? String(p.fixtureId) : null);
  if (smId) {
    const r = await sportmonks.request(`/fixtures/${encodeURIComponent(smId)}`, {
      include: 'league;participants;scores;periods'
    });
    const match = r.ok && r.data?.data ? sportmonks.transformFixture(r.data.data) : null;
    if (ledgerFinal(match)&&resultIdentityMatches(match,p)) return { match: { ...match, canonicalProvider: 'sportmonks' } };
  }
  const tsdbId=providerIdFor(p,'sportsdb');
  if (tsdbId && p.canonicalProvider === 'sportsdb') {
    const r = await sportsDb.getEventById(tsdbId).catch(() => ({ ok: false }));
    const event = r.ok ? (r.data?.events || [])[0] : null;
    const match = event && sportsDb.transformEvent(event);
    if (String(event?.idEvent)===tsdbId&&ledgerFinal(match)&&resultIdentityMatches(match,p)) return { match: { ...match, canonicalProvider: 'sportsdb' } };
  }
  return null;
}
async function settlePending() {
  const pending = await Prediction.find({ status: 'pending', kickoff: { $lt: new Date() } })
    .sort({ kickoff: 1 }).limit(150).lean();
  const day = (date, offset) => new Date(date.getTime() + offset * 86400000).toISOString().slice(0,10);
  const days = [...new Set(pending.flatMap(p => [-1,0,1].map(n => day(p.kickoff,n))))];
  const providerRows=[];
  for (const date of days) {
    const [raw,verified,sm,bsdResults]=await Promise.all([
      sportsDb.getMatchesByDate(date).catch(()=>({ok:false})),
      footballDataOrg.getMatchesByDate(date).catch(()=>({ok:false,matches:[]})),
      sportmonks.getFixturesByDate(date).catch(()=>({ok:false,fixtures:[]})),
      bsd.getRawFinalMatchesForDate(date).catch(()=>({ok:false,matches:[]}))
    ]);
    let fallback=raw.ok?(raw.data?.events||[]).map(sportsDb.transformEvent):[];
    if(verified.ok)fallback=footballDataOrg.mergeVerifiedScores(fallback,verified.matches);
    providerRows.push(...fallback.filter(ledgerFinal).map(m=>({...m,canonicalProvider:'sportsdb',providerIds:{sportsdb:String(m.fixtureId)}})));
    if(sm.ok)providerRows.push(...(sm.fixtures||[]).filter(ledgerFinal).map(m=>({...m,canonicalProvider:'sportmonks',providerIds:{sportmonks:String(m.sportmonksId||m.fixtureId)}})));
    if(bsdResults.ok)providerRows.push(...(bsdResults.matches||[]).filter(ledgerFinal).map(m=>({...m,canonicalProvider:'bsd'})));
  }
  let settled = 0;
  for (const p of pending) {
    const direct=await directCanonicalResult(p);
    let match=direct?.match || providerRows.find(m =>
      resultIdentityMatches(m,p) && (exactProviderMatch(m,p,'bsd') || exactProviderMatch(m,p,'sportmonks') ||
      exactProviderMatch(m,p,'sportsdb')));
    if(!match)match=providerRows.find(m=>resultIdentityMatches(m,p));
    const halftimeUnavailable=Boolean(match&&ledgerFinal(match)&&
      (Date.now()-new Date(p.kickoff).getTime()>=HALFTIME_GRACE_MS)&&
      (match.halftimeHome==null||match.halftimeAway==null));
    if (match && ledgerFinal(match) && (match.halftimeHome == null || match.halftimeAway == null) &&
        !halftimeUnavailable) continue;
    const actual = match && outcomes(match,{halftimeUnavailable});
    if (!actual) continue;
    const result = await Prediction.updateOne(
      { _id: p._id, status: 'pending' },
      { $set: { status: 'settled', actual, settledAt: new Date() } });
    if(result.modifiedCount){
      settled += result.modifiedCount;
      try{
        const powerRating=require('./powerRatingService');
        await powerRating.persistFromMatch({league:p.league||'',season:'',fixtureId:p.fixtureId,kickoff:p.kickoff,
          home:{id:match.homeTeamId||match.homeId||p.homeTeamId,name:p.homeTeam},away:{id:match.awayTeamId||match.awayId||p.awayTeamId,name:p.awayTeam},
          homeGoals:actual.homeScore,awayGoals:actual.awayScore});
      }catch(e){console.warn('[power-rating/settle]',p.fixtureId,e.message);}
    }
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

function metricRows(predictions){
 const groups=new Map(), bins=new Map();
 for(const p of predictions) for(const [market,probability] of Object.entries(p.probabilities||{})){
  const actual=p.actual?.[market]; if(!Number.isFinite(probability)||![0,1].includes(actual))continue;
  for(const key of ['all:'+market,(p.league||'Unknown')+':'+market]){
   if(!groups.has(key))groups.set(key,{league:key.startsWith('all:')?'all':p.league||'Unknown',market,count:0,brier:0,ll:0,pred:0,actual:0});
   const g=groups.get(key),q=Math.max(.001,Math.min(.999,probability));g.count++;g.brier+=(q-actual)**2;g.ll+=-(actual*Math.log(q)+(1-actual)*Math.log(1-q));g.pred+=q;g.actual+=actual;
   const bi=Math.min(9,Math.floor(q*10)),bk=key+':'+bi;if(!bins.has(bk))bins.set(bk,{key,bi,n:0,p:0,a:0});const b=bins.get(bk);b.n++;b.p+=q;b.a+=actual;
  }
 }
 return [...groups.entries()].map(([key,g])=>{const bs=[...bins.values()].filter(b=>b.key===key),ece=bs.reduce((s,b)=>s+(b.n/g.count)*Math.abs(b.p/b.n-b.a/b.n),0);return {league:g.league,market:g.market,count:g.count,brier:+(g.brier/g.count).toFixed(4),logLoss:+(g.ll/g.count).toFixed(4),ece:+ece.toFixed(4),predictedPercent:+(100*g.pred/g.count).toFixed(1),actualPercent:+(100*g.actual/g.count).toFixed(1)};});
}
async function walkForwardAudit(){
 const predictions=await Prediction.find({status:'settled'}).sort({kickoff:1}).select('modelVersion league probabilities rawProbabilities actual kickoff').lean();
 const byVersion={};
 for(const p of predictions){if(!byVersion[p.modelVersion])byVersion[p.modelVersion]=[];byVersion[p.modelVersion].push(p);}
 const versions=Object.entries(byVersion).map(([version,rows])=>({version,snapshots:rows.length,oneXTwo:multiclass1x2Metrics(rows),metrics:metricRows(rows)}));
 const bias=[];
 for(const row of metricRows(predictions)){if(row.count<20)continue;const gap=+(row.predictedPercent-row.actualPercent).toFixed(1);if(Math.abs(gap)>=5)bias.push({league:row.league,market:row.market,count:row.count,gapPercent:gap,direction:gap>0?'overprediction':'underprediction',ece:row.ece});}
 return {version:VERSION,totalSnapshots:predictions.length,oneXTwo:multiclass1x2Metrics(predictions),versions,biasFlags:bias.sort((a,b)=>Math.abs(b.gapPercent)-Math.abs(a.gapPercent))};
}


function multiclass1x2Metrics(rows){
 let n=0,rps=0,ll=0;
 for(const p of rows){
  const h=Number(p.probabilities?.home),d=Number(p.probabilities?.draw),a=Number(p.probabilities?.away);
  const y=[p.actual?.home,p.actual?.draw,p.actual?.away];
  if(![h,d,a].every(Number.isFinite)||y.filter(x=>x===1).length!==1)continue;
  const sum=h+d+a;if(sum<=0)continue;const q=[h/sum,d/sum,a/sum];
  const cq=[q[0],q[0]+q[1]],cy=[y[0],y[0]+y[1]];
  rps+=((cq[0]-cy[0])**2+(cq[1]-cy[1])**2)/2;
  const idx=y.findIndex(x=>x===1);ll+=-Math.log(Math.max(.001,q[idx]));n++;
 }
 return {count:n,rps:n?+(rps/n).toFixed(4):null,multiclassLogLoss:n?+(ll/n).toFixed(4):null};
}
function wilson(successes,n,z=1.96){
 if(!n)return {low:null,high:null};
 const p=successes/n,zz=z*z,den=1+zz/n;
 const center=(p+zz/(2*n))/den;
 const margin=z*Math.sqrt((p*(1-p)+zz/(4*n))/n)/den;
 return {low:+(100*Math.max(0,center-margin)).toFixed(1),high:+(100*Math.min(1,center+margin)).toFixed(1)};
}
function probabilityBuckets(predictions){
 const buckets=new Map();
 for(const p of predictions)for(const [market,prob] of Object.entries(p.probabilities||{})){
  const y=p.actual?.[market];if(!Number.isFinite(prob)||![0,1].includes(y))continue;
  const lo=Math.min(90,Math.floor(prob*10)*10),league=p.league||'Unknown';
  for(const scope of ['all',league]){
   const key=scope+':'+market+':'+lo;
   if(!buckets.has(key))buckets.set(key,{league:scope,market,from:lo,to:lo===90?100:lo+10,n:0,pred:0,hits:0});
   const b=buckets.get(key);b.n++;b.pred+=prob;b.hits+=y;
  }
 }
 return [...buckets.values()].map(b=>{
  const ci=wilson(b.hits,b.n),predicted=100*b.pred/b.n,observed=100*b.hits/b.n,gap=predicted-observed;
  // A bucket becomes decision-usable only with enough observations and when
  // its predicted rate is statistically compatible with the observed 95% CI.
  const calibratedInside95=ci.low!=null&&predicted>=ci.low&&predicted<=ci.high;
  const readiness=b.n<20?'collecting':b.n<50?'early-signal':'usable';
  return {...b,predictedPercent:+predicted.toFixed(1),observedPercent:+observed.toFixed(1),gapPercent:+gap.toFixed(1),wilson95:ci,calibratedInside95,readiness};
 });
}
function driftFlags(predictions){
 const byMarket={};
 for(const p of predictions)for(const [market,prob] of Object.entries(p.probabilities||{})){
  const y=p.actual?.[market];if(!Number.isFinite(prob)||![0,1].includes(y))continue;
  (byMarket[market]||(byMarket[market]=[])).push({p:prob,y,kickoff:p.kickoff});
 }
 const flags=[];
 for(const [market,rows] of Object.entries(byMarket)){
  if(rows.length<60)continue;rows.sort((a,b)=>new Date(a.kickoff)-new Date(b.kickoff));
  const recent=rows.slice(-30),baseline=rows.slice(0,-30);if(baseline.length<30)continue;
  const score=xs=>{let b=0,ll=0,p=0,a=0;for(const r of xs){const q=Math.max(.001,Math.min(.999,r.p));b+=(q-r.y)**2;ll+=-(r.y*Math.log(q)+(1-r.y)*Math.log(1-q));p+=q;a+=r.y}return {brier:b/xs.length,logLoss:ll/xs.length,gap:Math.abs(p-a)/xs.length};};
  const base=score(baseline),now=score(recent);
  const brierWorse=base.brier>0?(now.brier-base.brier)/base.brier:0;
  const gapWorse=now.gap-base.gap;
  if(brierWorse>=.15||gapWorse>=.07)flags.push({market,recentCount:recent.length,baselineCount:baseline.length,severity:brierWorse>=.25||gapWorse>=.12?'high':'watch',baselineBrier:+base.brier.toFixed(4),recentBrier:+now.brier.toFixed(4),brierWorseningPercent:+(100*brierWorse).toFixed(1),baselineGapPercent:+(100*base.gap).toFixed(1),recentGapPercent:+(100*now.gap).toFixed(1)});
 }
 return flags;
}
let healthCache={at:0,value:null};
function pickWon(key,a){
 if(!a)return null;
 if(['home','draw','away','over25','btts','fhHomeScores','fhAwayScores','fhOver05','shHomeScores','shAwayScores','shOver05'].includes(key))return a[key]===1;
 if(key==='under25')return a.over25===0;
 if(key==='bttsYes')return a.btts===1;if(key==='bttsNo')return a.btts===0;
 return null;
}
async function selectionPerformance(){
 const rows=await Prediction.find({status:'settled',selectionVersion:SELECTION_VERSION,'topPicksSnapshot.0':{$exists:true}}).select('topPicksSnapshot closingLineSnapshot closingLineCapturedAt actual selectionVersion kickoff').lean();
 let bets=0,wins=0,staked=0,returned=0,expected=0,clvCount=0,clvSum=0,positiveClv=0;
 const byMarket={};
 for(const r of rows)for(const p of r.topPicksSnapshot||[]){
  if(p.oddsFresh!==true||!(Number(p.odds)>1))continue;const won=pickWon(p.key,r.actual);if(won==null)continue;
  bets++;staked++;expected+=Number(p.expectedValuePercent||0)/100;if(won){wins++;returned+=Number(p.odds);}
  const close=(r.closingLineSnapshot||[]).find(x=>x.key===p.key);if(Number(close?.odds)>1){const clv=Number(p.odds)/Number(close.odds)-1;clvCount++;clvSum+=clv;if(clv>0)positiveClv++;}
  const k=p.market||p.key,b=byMarket[k]||(byMarket[k]={bets:0,wins:0,staked:0,returned:0});b.bets++;b.staked++;if(won){b.wins++;b.returned+=Number(p.odds);}
 }
 const fmt=b=>({...b,hitRatePercent:b.bets?+(100*b.wins/b.bets).toFixed(1):null,roiPercent:b.staked?+(100*(b.returned-b.staked)/b.staked).toFixed(1):null});
 return {selectionVersion:SELECTION_VERSION,bets,wins,hitRatePercent:bets?+(100*wins/bets).toFixed(1):null,roiPercent:staked?+(100*(returned-staked)/staked).toFixed(1):null,meanExpectedValuePercent:bets?+(100*expected/bets).toFixed(1):null,clvCount,averageClvPercent:clvCount?+(100*clvSum/clvCount).toFixed(2):null,positiveClvPercent:clvCount?+(100*positiveClv/clvCount).toFixed(1):null,byMarket:Object.fromEntries(Object.entries(byMarket).map(([k,v])=>[k,fmt(v)])),note:'Prospective settled picks with fresh captured bookmaker odds only.'};
}
async function calibrationHealth(options={}){
 if(options.cached&&healthCache.value&&Date.now()-healthCache.at<15*60*1000)return healthCache.value;
 const rows=await Prediction.find({status:'settled',modelVersion:VERSION}).sort({kickoff:1}).select('league probabilities actual kickoff calibrationVersion selectionVersion').lean();
 const buckets=probabilityBuckets(rows),drift=driftFlags(rows);
 const bucketAlerts=buckets.filter(b=>b.n>=20&&Math.abs(b.gapPercent)>=8).map(b=>({league:b.league,market:b.market,range:[b.from,b.to],count:b.n,gapPercent:b.gapPercent,wilson95:b.wilson95,calibratedInside95:b.calibratedInside95,severity:b.n>=50&&!b.calibratedInside95&&Math.abs(b.gapPercent)>=12?'high':'watch'}));
 const value={modelVersion:VERSION,snapshots:rows.length,oneXTwo:multiclass1x2Metrics(rows),buckets,drift,bucketAlerts,healthy:drift.every(x=>x.severity!=='high')&&bucketAlerts.every(x=>x.severity!=='high'),readiness:rows.length<30?'collecting':rows.length<100?'early-signal':'decision-ready'};
 healthCache={at:Date.now(),value};return value;
}
async function pairedAudit(){
 const rows=await Prediction.find({status:'settled',comparisonProbabilities:{$ne:null}}).sort({kickoff:1}).select('league probabilities comparisonProbabilities actual kickoff').lean();
 const current=metricRows(rows);
 const baseline=metricRows(rows.map(p=>({...p,probabilities:p.comparisonProbabilities})));
 const key=r=>r.league+'::'+r.market,base=new Map(baseline.map(r=>[key(r),r]));
 const comparisons=current.map(r=>{const b=base.get(key(r));if(!b)return null;return {league:r.league,market:r.market,count:r.count,baselineBrier:b.brier,currentBrier:r.brier,brierDelta:+(r.brier-b.brier).toFixed(4),baselineLogLoss:b.logLoss,currentLogLoss:r.logLoss,logLossDelta:+(r.logLoss-b.logLoss).toFixed(4),baselineEce:b.ece,currentEce:r.ece,eceDelta:+(r.ece-b.ece).toFixed(4)};}).filter(Boolean);
 const readiness = rows.length < 30 ? 'collecting' : rows.length < 100 ? 'early-signal' : 'decision-ready';
 const guardedComparisons=comparisons.map(x=>({...x,decisionEligible:x.count>=100,earlySignal:x.count>=30}));
 return {version:VERSION,design:'paired-prospective-same-fixtures',baseline:'raw-pre-calibration-pipeline',snapshots:rows.length,readiness,minimums:{earlySignal:30,decisionEligible:100},comparisons:guardedComparisons};
}

function strongestPickHit(p){
  const key=p.strongestPick?.key,a=p.actual||{};
  if(!key)return null;
  if(key==='home'||key==='draw'||key==='away') return a[key]===1;
  if(key==='over25')return a.over25===1;
  if(key==='under25')return a.over25===0;
  if(key==='bttsYes')return a.btts===1;
  if(key==='bttsNo')return a.btts===0;
  return null;
}
async function strongestPickPerformance(){
  const rows=await Prediction.find({status:'settled',strongestPick:{$ne:null}})
    .select('league kickoff homeTeam awayTeam strongestPick actual').sort({kickoff:1}).lean();
  const evaluated=rows.map(p=>({p,hit:strongestPickHit(p)})).filter(x=>x.hit!==null);
  const wins=evaluated.filter(x=>x.hit).length, losses=evaluated.length-wins;
  return {count:evaluated.length,wins,losses,hitRatePercent:evaluated.length?+(100*wins/evaluated.length).toFixed(1):null,
    readiness:evaluated.length<30?'collecting':evaluated.length<100?'early-signal':'decision-ready'};
}

async function performance() {
  const [totalSnapshots, settledSnapshots, pendingSnapshots, predictions] = await Promise.all([
    Prediction.countDocuments({}),
    Prediction.countDocuments({ status: 'settled' }),
    Prediction.countDocuments({ status: 'pending' }),
    Prediction.find({ status: 'settled' }).select('league probabilities actual kickoff').lean()
  ]);
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
  const rows=[...groups.values()].map(g => ({
    league:g.league,market:g.market,count:g.count,
    accuracy:+(100*g.correct/g.count).toFixed(1),
    brier:+(g.brierSum/g.count).toFixed(4),
    logLoss:+(g.logLossSum/g.count).toFixed(4),
    predictedPercent:+(100*g.predictedSum/g.count).toFixed(1),
    actualPercent:+(100*g.actualSum/g.count).toFixed(1),
    calibrationGapPercent:+Math.abs(100*(g.predictedSum-g.actualSum)/g.count).toFixed(1)
  }));
  const allRow = market => rows.find(r => r.league === 'all' && r.market === market) || null;
  const marketAccuracy = {
    home: allRow('home')?.accuracy ?? null,
    draw: allRow('draw')?.accuracy ?? null,
    away: allRow('away')?.accuracy ?? null,
    over25: allRow('over25')?.accuracy ?? null,
    btts: allRow('btts')?.accuracy ?? null
  };
  const totalDecisions = rows.filter(r => r.league === 'all').reduce((n,r)=>n+r.count,0);
  const weightedAccuracy = totalDecisions
    ? +(rows.filter(r=>r.league==='all').reduce((n,r)=>n+r.accuracy*r.count,0)/totalDecisions).toFixed(1)
    : null;
  return {
    version:VERSION,
    strongestPick: await strongestPickPerformance(),
    summary:{
      totalSnapshots,
      settledSnapshots,
      pendingSnapshots,
      settlementRatePercent: totalSnapshots ? +(100*settledSnapshots/totalSnapshots).toFixed(1) : 0,
      evaluatedMarketDecisions: totalDecisions,
      weightedAccuracyPercent: weightedAccuracy,
      marketAccuracyPercent: marketAccuracy
    },
    snapshots:predictions.length,
    scoring:['accuracy','brier','logLoss','calibrationGap'],
    rows
  };
}
function v4MarkerHit(p,v){if(!v?.key)return null;return strongestPickHit({...p,strongestPick:{key:v.key}})}
async function v4CrossCheckPerformance(){
 const rows=await Prediction.find({status:'settled','v4Validation.kind':'fixture-cross-check'}).select('league actual v4Validation').lean();const groups={};
 for(const p of rows){for(const v of (p.v4Validation||[]).filter(x=>x?.kind==='fixture-cross-check')){const hit=v4MarkerHit(p,v);if(hit===null)continue;const a=v.agreement||'unavailable',k=a+'::'+(v.market||'unknown'),g=groups[k]||(groups[k]={agreement:a,market:v.market||'unknown',count:0,wins:0});g.count++;if(hit)g.wins++}}
 return Object.values(groups).map(g=>({...g,losses:g.count-g.wins,hitRatePercent:g.count?+(100*g.wins/g.count).toFixed(1):null,readiness:g.count<30?'collecting':g.count<100?'early-signal':'decision-ready'}));
}
async function v4ActivationStatus(){
 const rows=await Prediction.find({status:'settled','v4Validation.kind':'fixture-cross-check'}).select('strongestPick actual v4Validation').sort({kickoff:1}).lean();
 let n=0,aiWins=0,v4Wins=0,aiBrier=0,v4Brier=0,calAi=0,calV4=0;
 for(const p of rows){const v=(p.v4Validation||[]).find(x=>x?.kind==='fixture-cross-check');if(!v)continue;const hit=strongestPickHit(p);const ap=Number(p.strongestPick?.probability)/100,vp=Number(v.simulation)/100;if(hit===null||!Number.isFinite(ap)||!Number.isFinite(vp))continue;const y=hit?1:0;n++;if((ap>=.5)===!!y)aiWins++;if((vp>=.5)===!!y)v4Wins++;aiBrier+=(ap-y)**2;v4Brier+=(vp-y)**2;calAi+=Math.abs(ap-y);calV4+=Math.abs(vp-y)}
 const aiB=n?aiBrier/n:null,v4B=n?v4Brier/n:null,aiHit=n?100*aiWins/n:null,v4Hit=n?100*v4Wins/n:null;
 const eligible=n>=100;
 // V4 may influence production only when it has at least 100 paired prospective results AND
 // is not worse on hit rate, improves Brier by >=2%, and is not worse on mean calibration error.
 const brierGain=eligible&&aiB>0?100*(aiB-v4B)/aiB:null;
 const validated=!!(eligible&&v4Hit>=aiHit&&brierGain>=2&&(calV4/n)<=(calAi/n));
 return{mode:validated?'validated':'shadow',validated,pairedResults:n,minimumPairedResults:100,remaining:Math.max(0,100-n),metrics:{aiHitRatePercent:aiHit==null?null:+aiHit.toFixed(1),v4HitRatePercent:v4Hit==null?null:+v4Hit.toFixed(1),aiBrier:aiB==null?null:+aiB.toFixed(4),v4Brier:v4B==null?null:+v4B.toFixed(4),v4BrierImprovementPercent:brierGain==null?null:+brierGain.toFixed(2),aiMeanAbsoluteCalibrationError:n?+(calAi/n).toFixed(4):null,v4MeanAbsoluteCalibrationError:n?+(calV4/n).toFixed(4):null},activationRule:'100 paired prospective settled picks + V4 hit rate >= AI + V4 Brier >=2% better + V4 calibration error <= AI',note:eligible&&!validated?'100 reached but validation criteria not met; V4 remains shadow and keeps collecting data':null};
}
async function reportCard(fixtureId){
 const [perf,snapshot]=await Promise.all([performance(),Prediction.findOne({fixtureId:String(fixtureId),modelVersion:VERSION}).lean()]);
 const marketMap={home:'home',draw:'draw',away:'away',over25:'over25',under25:'over25',bttsYes:'btts',bttsNo:'btts'};
 const rows=perf.rows||[],pick=snapshot?.strongestPick||null,metric=pick?marketMap[pick.key]:null;
 const all=metric?rows.find(x=>x.league==='all'&&x.market===metric):null,league=metric&&snapshot?rows.find(x=>x.league===snapshot.league&&x.market===metric):null;
 const hit=snapshot?.status==='settled'?strongestPickHit(snapshot):null;
 return {version:VERSION,edgeId:snapshot?String(snapshot._id):null,fixtureId:String(fixtureId),lockedAt:snapshot?.capturedAt||null,status:snapshot?.status||'not-captured',result:hit===null?(snapshot?.status==='settled'?'void':'pending'):(hit?'won':'lost'),strongestPick:pick,modelHistory:{market:metric,overall:all?{count:all.count,accuracy:all.accuracy,brier:all.brier,calibrationGapPercent:all.calibrationGapPercent}:null,league:league?{league:league.league,count:league.count,accuracy:league.accuracy,brier:league.brier,calibrationGapPercent:league.calibrationGapPercent}:null},readiness:all?(all.count<30?'collecting':all.count<100?'early-signal':'established'):'collecting'};
}


function normalizeClosingMarketRows(board){
  const rows=[]; const books=Array.isArray(board?.bookmakers)?board.bookmakers.filter(b=>b.fresh===true):[];
  const addThreeWay=(b)=>{
    const h=b?.h2h;if(!h||![h.home,h.draw,h.away].every(x=>Number(x)>1))return;
    const sum=1/Number(h.home)+1/Number(h.draw)+1/Number(h.away);
    for(const [key,odds] of [['home',h.home],['draw',h.draw],['away',h.away]])rows.push({key,odds:Number(odds),bookmaker:b.bookmaker||null,deVigProbability:+(((1/Number(odds))/sum)*100).toFixed(2)});
  };
  const addPair=(b,yesKey,noKey,pair)=>{
    const yes=Number(pair?.yes??pair?.over),no=Number(pair?.no??pair?.under);if(!(yes>1&&no>1))return;
    const sum=1/yes+1/no;rows.push({key:yesKey,odds:yes,bookmaker:b.bookmaker||null,deVigProbability:+(((1/yes)/sum)*100).toFixed(2)});rows.push({key:noKey,odds:no,bookmaker:b.bookmaker||null,deVigProbability:+(((1/no)/sum)*100).toFixed(2)});
  };
  for(const b of books){addThreeWay(b);addPair(b,'over25','under25',b.totals?{over:b.totals.over25,under:b.totals.under25}:null);addPair(b,'bttsYes','bttsNo',b.btts);}
  const best=new Map();for(const r of rows){const old=best.get(r.key);if(!old||r.odds>old.odds)best.set(r.key,r);}return [...best.values()];
}
async function captureClosingLines(){
  const now=new Date(),horizon=new Date(Date.now()+75*60*1000);
  const pending=await Prediction.find({status:'pending',kickoff:{$gt:now,$lte:horizon},closingLineCapturedAt:null}).limit(40);
  let captured=0,skipped=0;
  for(const p of pending){
    try{
      const policy=require('./sourcePolicyService').resolveSourcePolicy(p.league||'');
      const sportKey=policy?.oddsKey||null;if(!sportKey){skipped++;continue;}
      const odds=await require('./oddsApiService').getOddsForLeague(sportKey);
      if(!odds.ok){skipped++;continue;}
      const board=require('./oddsApiService').extractMatchMarketOdds(odds.data,p.homeTeam,p.awayTeam);
      const rows=normalizeClosingMarketRows(board);
      if(!rows.length){skipped++;continue;}
      p.closingLineSnapshot=rows;p.closingLineCapturedAt=new Date();await p.save();captured++;
    }catch(e){console.error('[closing-line]',p.fixtureId,e.message);skipped++;}
  }
  return {checked:pending.length,captured,skipped};
}
function clvForPick(pick,closingRows){
  const close=(closingRows||[]).find(x=>x.key===pick.key);const open=Number(pick.odds),closing=Number(close?.odds);
  if(!(pick.oddsFresh===true&&open>1&&closing>1))return null;
  return {closingOdds:closing,clvPercent:+((open/closing-1)*100).toFixed(2),closingDeVigProbability:close.deVigProbability??null};
}

module.exports = { capture, settlePending, performance, strongestPickPerformance, sportmonksBacktest, walkForwardAudit, pairedAudit, reportCard, v4CrossCheckPerformance, v4ActivationStatus, calibrationHealth, selectionPerformance, outcomes, exactProviderMatch, resultIdentityMatches, HALFTIME_GRACE_MS, VERSION, SELECTION_VERSION };
