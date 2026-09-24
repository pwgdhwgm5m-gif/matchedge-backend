/**
 * SoccerEdge Pro Premium Intelligence
 *
 * Produces a transparent decision layer above the raw probability model.
 * It deliberately uses model-only probabilities for edge calculations; using
 * the already market-blended probability would hide disagreement with price.
 */

const OUTCOMES = [
  { key: 'home', modelKey: 'homeWinProbability', marketKey: 'home', oddsKey: 'home' },
  { key: 'draw', modelKey: 'drawProbability', marketKey: 'draw', oddsKey: 'draw' },
  { key: 'away', modelKey: 'awayWinProbability', marketKey: 'away', oddsKey: 'away' },
];
const marketEvidenceService = require('./marketEvidenceService');

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function buildMarketBoard({ modelProbabilities, goalMarkets, cornerMetrics, halfMarkets, marketEvidence={}, dataHealth, premium, sportmonksIntel, sportmonksMarketEvidence, evidenceStrength=0.5, modelAgreementScore=50, marketOddsBoard=null, extendedOddsBoard=null, modelHealth=null }) {
  let health = Number(dataHealth?.score || 0);
  const verifiedStats = Number(sportmonksIntel?.verifiedStats || 0);
  const lineupComplete = sportmonksIntel?.lineupComplete === true || ((sportmonksIntel?.homeStarters || 0) >= 11 && (sportmonksIntel?.awayStarters || 0) >= 11);
  health = Math.min(100, health + (verifiedStats >= 2 ? 3 : 0) + (verifiedStats >= 6 ? 3 : 0) + (verifiedStats >= 10 ? 2 : 0) + (lineupComplete ? 5 : 0));
  const candidates = [
    { key: 'home', market: '1X2', label: 'Ev Sahibi', probability: Number(modelProbabilities?.homeWinProbability || 0) },
    { key: 'draw', market: '1X2', label: 'Beraberlik', probability: Number(modelProbabilities?.drawProbability || 0) },
    { key: 'away', market: '1X2', label: 'Deplasman', probability: Number(modelProbabilities?.awayWinProbability || 0) },
    { key: 'over25', market: 'GOL', label: '2.5 Üst', probability: Number(goalMarkets?.over25GoalsPercent || 0) },
    { key: 'under25', market: 'GOL', label: '2.5 Alt', probability: 100 - Number(goalMarkets?.over25GoalsPercent || 0) },
    { key: 'bttsYes', market: 'KG', label: 'KG Var', direction:'YES', probability: Number(goalMarkets?.bttsPercent || 0) },
    { key: 'bttsNo', market: 'KG', label: 'KG Yok', direction:'NO', probability: 100 - Number(goalMarkets?.bttsPercent || 0) },
    { key: 'over15', market: 'GOL', label: '1.5 Üst', probability: Number(goalMarkets?.totalGoals?.['1.5']?.over || 0) },
    { key: 'over35', market: 'GOL', label: '3.5 Üst', probability: Number(goalMarkets?.totalGoals?.['3.5']?.over || 0) },
    { key: 'under35', market: 'GOL', label: '3.5 Alt', probability: Number(goalMarkets?.totalGoals?.['3.5']?.under || 0) },
    { key: 'homeScores', market: 'TAKIM GOLÜ', label: 'Ev Sahibi Gol Atar', probability: Number(goalMarkets?.scoring?.home || 0) },
    { key: 'awayScores', market: 'TAKIM GOLÜ', label: 'Deplasman Gol Atar', probability: Number(goalMarkets?.scoring?.away || 0) },
    { key: 'homeOver15', market: 'EV TAKIM GOLÜ', label: 'Ev 1.5 Üst', probability: Number(goalMarkets?.teamGoals?.home?.['1.5']?.over || 0) },
    { key: 'homeOver25', market: 'EV TAKIM GOLÜ', label: 'Ev 2.5 Üst', probability: Number(goalMarkets?.teamGoals?.home?.['2.5']?.over || 0) },
    { key: 'homeOver35', market: 'EV TAKIM GOLÜ', label: 'Ev 3.5 Üst', probability: Number(goalMarkets?.teamGoals?.home?.['3.5']?.over || 0) },
    { key: 'awayOver15', market: 'DEP TAKIM GOLÜ', label: 'Dep 1.5 Üst', probability: Number(goalMarkets?.teamGoals?.away?.['1.5']?.over || 0) },
    { key: 'awayOver25', market: 'DEP TAKIM GOLÜ', label: 'Dep 2.5 Üst', probability: Number(goalMarkets?.teamGoals?.away?.['2.5']?.over || 0) },
    { key: 'awayOver35', market: 'DEP TAKIM GOLÜ', label: 'Dep 3.5 Üst', probability: Number(goalMarkets?.teamGoals?.away?.['3.5']?.over || 0) },
    { key: 'cornersOver95', market: 'KORNER', label: '9.5 Üst Korner', probability: Number(cornerMetrics?.over95Percent || 0) },
    { key: 'cornersUnder95', market: 'KORNER', label: '9.5 Alt Korner', probability: Number(cornerMetrics?.under95Percent ?? (100 - Number(cornerMetrics?.over95Percent || 0))) },
    { key: 'fhHome', market: 'İLK YARI', label: 'Ev Sahibi', probability: Number(halfMarkets?.firstHalf?.home || 0) },
    { key: 'fhDraw', market: 'İLK YARI', label: 'Beraberlik', probability: Number(halfMarkets?.firstHalf?.draw || 0) },
    { key: 'fhAway', market: 'İLK YARI', label: 'Deplasman', probability: Number(halfMarkets?.firstHalf?.away || 0) },
    { key: 'fhHomeScores', market: 'İLK YARI GOL', label: 'Ev İlk Yarı Gol Atar', probability: Number(halfMarkets?.firstHalf?.homeScores || 0) },
    { key: 'fhAwayScores', market: 'İLK YARI GOL', label: 'Dep İlk Yarı Gol Atar', probability: Number(halfMarkets?.firstHalf?.awayScores || 0) },
    { key: 'fhOver05', market: 'İLK YARI GOL', label: 'İlk Yarı 0.5 Üst', probability: Number(halfMarkets?.firstHalf?.over05 || 0) },
    { key: 'shHome', market: 'İKİNCİ YARI', label: 'Ev Sahibi', probability: Number(halfMarkets?.secondHalf?.home || 0) },
    { key: 'shDraw', market: 'İKİNCİ YARI', label: 'Beraberlik', probability: Number(halfMarkets?.secondHalf?.draw || 0) },
    { key: 'shAway', market: 'İKİNCİ YARI', label: 'Deplasman', probability: Number(halfMarkets?.secondHalf?.away || 0) },
    { key: 'shHomeScores', market: 'İKİNCİ YARI GOL', label: 'Ev İkinci Yarı Gol Atar', probability: Number(halfMarkets?.secondHalf?.homeScores || 0) },
    { key: 'shAwayScores', market: 'İKİNCİ YARI GOL', label: 'Dep İkinci Yarı Gol Atar', probability: Number(halfMarkets?.secondHalf?.awayScores || 0) },
    { key: 'shOver05', market: 'İKİNCİ YARI GOL', label: 'İkinci Yarı 0.5 Üst', probability: Number(halfMarkets?.secondHalf?.over05 || 0) },
    { key: 'mostGoalsFirst', market: 'EN GOLLÜ YARI', label: 'İlk Yarı', probability: Number(halfMarkets?.mostGoalsHalf?.first || 0) },
    { key: 'mostGoalsEqual', market: 'EN GOLLÜ YARI', label: 'Eşit', probability: Number(halfMarkets?.mostGoalsHalf?.equal || 0) },
    { key: 'mostGoalsSecond', market: 'EN GOLLÜ YARI', label: 'İkinci Yarı', probability: Number(halfMarkets?.mostGoalsHalf?.second || 0) },
  ].filter(item => Number.isFinite(item.probability) && item.probability >= 0 && item.probability <= 100)
    .map(item => {
      const ev=sportmonksMarketEvidence||{};
      const assessment=marketEvidence?.[item.key]||{
        evidenceLevel:'INSUFFICIENT',
        effectiveSample:0,
        evidenceSource:['NO_DATA'],
        priorUsed:true,
        strongPickEligible:false,
      };
      item.evidenceLevel=assessment.evidenceLevel||'INSUFFICIENT';
      item.effectiveSample=Number(assessment.effectiveSample)||0;
      item.evidenceSource=Array.isArray(assessment.evidenceSource)?assessment.evidenceSource:[];
      item.priorUsed=assessment.priorUsed===true;
      item.strongPickEligible=assessment.strongPickEligible===true &&
        item.evidenceLevel==='SUFFICIENT' && item.effectiveSample>=8;
      let evidence=null;
      if(item.market==='1X2') evidence=item.key==='home'?ev.homeThreat:item.key==='away'?ev.awayThreat:(ev.homeThreat!=null&&ev.awayThreat!=null?1-Math.min(.25,Math.abs(ev.homeThreat-ev.awayThreat)*.35):null);
      else if(item.key==='over25') evidence=ev.goalQuality;
      else if(item.key==='under25') evidence=ev.goalQuality!=null?2-ev.goalQuality:null;
      else if(item.key==='bttsYes') evidence=ev.bttsQuality;
      else if(item.key==='bttsNo') evidence=ev.bttsQuality!=null?2-ev.bttsQuality:null;
      else if(item.market==='KORNER') evidence=item.key==='cornersOver95'?ev.cornerQuality:(ev.cornerQuality!=null?2-ev.cornerQuality:null);
      else if(item.market==='TAKIM GOLÜ'||item.market==='EV TAKIM GOLÜ') evidence=item.key.startsWith('home')?ev.homeThreat:ev.awayThreat;
      else if(item.market==='DEP TAKIM GOLÜ') evidence=ev.awayThreat;
      else if(item.market==='İLK YARI GOL'||item.market==='İKİNCİ YARI GOL') evidence=ev.goalQuality;
      const evidenceBonus=evidence==null?0:clamp((evidence-1)*12,-4,4);
      // Rank markets by their own evidence quality. A high headline probability
      // should not outrank a better-supported market merely because it is more
      // extreme. 1X2 may use 1X2 agreement; binary/corner markets do not inherit it.
      const baseEvidence=clamp(Number(evidenceStrength)||0,.25,1);
      const marketEvidenceReliability=evidence==null?baseEvidence:clamp(baseEvidence*(.75+.25*clamp(evidence,.65,1.35)),.25,1);
      const agreementFactor=item.market==='1X2'?clamp(Number(modelAgreementScore)||0,0,100)/100:1;
      const reliability=clamp(marketEvidenceReliability*(item.market==='1X2'?(.75+.25*agreementFactor):1),.25,1);
      const confidenceEdge=Math.max(0,item.probability-50);
      return {
        ...item,
        probability: +item.probability.toFixed(1),
        score: +(confidenceEdge*0.62*reliability + health*0.22 + evidenceBonus).toFixed(1),
        dataHealth: health,
        sportmonksEvidence: evidence==null?null:+evidence.toFixed(3),
        sportmonksEvidenceBonus:+evidenceBonus.toFixed(1),
        evidenceReliability:+reliability.toFixed(3),
        isValue: premium?.status === 'VALUE' && premium?.selection === item.key,
        edgePoints: premium?.selection === item.key ? premium?.bestEdge?.edgePoints ?? null : null,
      };
    })
    .sort((a, b) => b.score - a.score || b.probability - a.probability);

  // Betting-value layer. Top Picks are not "the highest probabilities".
  // They must have a verified bookmaker price, positive expected value and a
  // meaningful de-vigged edge. High-base-rate markets (for example 2H O0.5)
  // stay available in analysis but cannot dominate Top Picks merely because
  // their raw occurrence probability is high.
  const healthGate=modelHealth?.readiness==='decision-ready'&&modelHealth?.healthy===false;
  const driftMarkets=new Set((modelHealth?.drift||[]).filter(x=>x.severity==='high').map(x=>x.market));
  const bucketMarkets=new Set((modelHealth?.bucketAlerts||[]).filter(x=>x.severity==='high').map(x=>x.market));
  const priceMap = new Map();
  const extendedBooks=extendedOddsBoard?.bookmakers||[];
  const completePair=(a,b)=>Number(a)>1&&Number(b)>1;
  for(const b of extendedBooks){
   if(b.fresh!==true)continue;
   const addPair=(yesKey,noKey,pair)=>{
    if(!pair||!completePair(pair.yes??pair.over,pair.no??pair.under))return;
    const yo=Number(pair.yes??pair.over),no=Number(pair.no??pair.under),sum=1/yo+1/no;
    priceMap.set(yesKey,{bookmaker:b.bookmaker,odds:yo,deVigProbability:(1/yo)/sum,overround:sum,verifiedFresh:true});
    priceMap.set(noKey,{bookmaker:b.bookmaker,odds:no,deVigProbability:(1/no)/sum,overround:sum,verifiedFresh:true});
   };
   addPair('bttsYes','bttsNo',b.btts);
   for(const side of ['home','away'])for(const line of ['1.5','2.5','3.5']){
    const pair=b.teamTotals?.[side]?.[line];
    const prefix=side==='home'?'homeOver':'awayOver';
    const underPrefix=side==='home'?'homeUnder':'awayUnder';
    addPair(prefix+line.replace('.',''),underPrefix+line.replace('.',''),pair);
   }
   if(b.firstHalfTotal05)addPair('fhOver05','fhUnder05',b.firstHalfTotal05);
   if(b.firstHalfTeam05?.home)addPair('fhHomeScores','fhHomeNoScore',b.firstHalfTeam05.home);
   if(b.firstHalfTeam05?.away)addPair('fhAwayScores','fhAwayNoScore',b.firstHalfTeam05.away);
   const h=b.firstHalf;if(h&&Number(h.home)>1&&Number(h.draw)>1&&Number(h.away)>1){
    const s=1/Number(h.home)+1/Number(h.draw)+1/Number(h.away);
    for(const [key,odd] of [['fhHome',h.home],['fhDraw',h.draw],['fhAway',h.away]])priceMap.set(key,{bookmaker:b.bookmaker,odds:Number(odd),deVigProbability:(1/Number(odd))/s,overround:s,verifiedFresh:true});
   }
  }

  const books = Array.isArray(marketOddsBoard?.bookmakers) ? marketOddsBoard.bookmakers : [];
  const registerBook = (bookmaker, family, odds) => {
    if (!odds) return;
    const entries = family === '1X2'
      ? [['home',odds.home],['draw',odds.draw],['away',odds.away]]
      : [['over25',odds.over25],['under25',odds.under25]];
    const valid=entries.filter(([,o])=>Number(o)>1);
    if(valid.length!==entries.length)return;
    const overround=valid.reduce((sum,[,o])=>sum+1/Number(o),0);
    if(!(overround>0))return;
    for(const [key,odd] of valid){
      const deVig=(1/Number(odd))/overround*100;
      const current=priceMap.get(key);
      // Best executable price is used for EV; its own bookmaker market is used
      // for de-vig so we never construct a synthetic "best-odds book".
      if(!current || Number(odd)>current.odds) priceMap.set(key,{bookmaker,odds:Number(odd),deVigProbability:deVig,overround,verifiedFresh:true});
    }
  };
  for(const b of books){if(b.fresh!==true)continue;registerBook(b.bookmaker,'1X2',b.h2h);registerBook(b.bookmaker,'TOTALS',b.totals);}

  for(const item of candidates){
    const px=priceMap.get(item.key);
    item.verifiedOdds=px?.odds??null;
    item.bookmaker=px?.bookmaker??null;
    item.oddsFresh=px?.verifiedFresh===true;
    item.marketImpliedProbability=px?+px.deVigProbability.toFixed(1):null;
    item.edgePoints=px?+(item.probability-px.deVigProbability).toFixed(1):null;
    item.expectedValuePercent=px?+((item.probability/100*px.odds-1)*100).toFixed(1):null;
    // Reliability makes the eligibility threshold stricter on weaker evidence;
    // it does not multiply probabilities or manufacture a larger edge.
    const uncertaintyBuffer=+(2+(1-item.evidenceReliability)*4).toFixed(1);
    item.valueThresholdPoints=uncertaintyBuffer;
    const cornerTopPickReady = item.market!=='KORNER' || (
      Number(cornerMetrics?.sample)>=8 &&
      cornerMetrics?.lowEvidence!==true &&
      ['sportmonks-history-pressure','historical-corners'].includes(String(cornerMetrics?.source||''))
    );
    const excludedFromTopPicks = item.key === 'shOver05' || !cornerTopPickReady;
    const healthMarket=item.key==='bttsYes'||item.key==='bttsNo'?'btts':item.key==='under25'?'over25':item.key;
    const degraded=healthGate&&(driftMarkets.has(healthMarket)||bucketMarkets.has(healthMarket));
    item.isBettingValue=Boolean(!excludedFromTopPicks && !degraded && item.strongPickEligible && px && item.expectedValuePercent>0 && item.edgePoints>=uncertaintyBuffer && item.evidenceReliability>=.50 && health>=55);
    item.topPickExclusion = !cornerTopPickReady ? 'INSUFFICIENT_REAL_CORNER_EVIDENCE' : (item.key==='shOver05' ? 'HIGH_BASE_RATE_INFORMATIONAL_MARKET' : (degraded ? 'MODEL_HEALTH_GATE' : (!item.strongPickEligible ? 'INSUFFICIENT_MARKET_EVIDENCE' : null)));
    item.valueScore=item.isBettingValue
      ? +(item.expectedValuePercent*.45 + item.edgePoints*.35 + item.evidenceReliability*20).toFixed(2)
      : null;
  }

  // Top Picks answer a different product question from Value Picks:
  // "what does the analysis support most strongly?" vs "is the quoted price
  // mathematically attractive?". Odds availability must never erase a strong
  // analytical selection. Value remains a stricter, independently verified tag.
  const valueEligible=candidates.filter(x=>x.isBettingValue)
    .sort((a,b)=>b.valueScore-a.valueScore || b.edgePoints-a.edgePoints || b.probability-a.probability);
  // Customer-facing Top Picks / For You focus on the three core actionable
  // pre-match families requested for this surface: match winner, BTTS Yes and
  // Over 2.5. Other markets remain available in full Match Analysis.
  // Price-aware major-market pool. Team-total lines are eligible because a
  // harder line can be economically stronger than an obvious short-priced
  // high-probability line. They still need the same football evidence floor;
  // price alone can never rescue a weak signal.
  const coreTopPickKeys=new Set(['home','away','bttsYes','over25','homeOver15','homeOver25','homeOver35','awayOver15','awayOver25','awayOver35']);
  const topEligible=candidates.filter(x=>
    coreTopPickKeys.has(x.key) &&
    !x.topPickExclusion &&
    x.strongPickEligible === true &&
    x.probability>=50 &&
    x.evidenceReliability>=.45 &&
    health>=45
  ).map(item=>{
    // Top Pick remains model-led, but a verified fresh executable price is
    // economically relevant. Reward positive EV/edge without allowing odds to
    // rescue a weak football signal. Missing/stale prices contribute nothing.
    const hasFreshPrice=item.oddsFresh===true && Number(item.verifiedOdds)>1;
    const positiveEv=hasFreshPrice?Math.max(0,Number(item.expectedValuePercent)||0):0;
    const positiveEdge=hasFreshPrice?Math.max(0,Number(item.edgePoints)||0):0;
    // When a verified price exists, penalize negative/ordinary pricing and
    // reward genuine de-vig edge/EV. This prevents an easy 1.5 line from
    // dominating solely because its occurrence probability is high.
    const negativeEv=hasFreshPrice?Math.max(0,-Number(item.expectedValuePercent||0)):0;
    const priceAdjustment=hasFreshPrice
      ? Math.min(18,positiveEv)*.45 + Math.min(12,positiveEdge)*.30 - Math.min(12,negativeEv)*.35
      : 0;
    return {...item,topPickScore:+(Number(item.score||0)+priceAdjustment).toFixed(2)};
  }).sort((a,b)=>{
    return b.topPickScore-a.topPickScore || b.score-a.score || b.probability-a.probability;
  });
  const diversify = pool => {
    const out=[], usedFamilies=new Set();
    for(const item of pool){
      if(out.length>=3)break;
      const family=item.market==='1X2'?'1X2':item.market==='GOL'&&['over25','under25'].includes(item.key)?'TOTALS_25':item.market;
      if(usedFamilies.has(family))continue;
      out.push(item);usedFamilies.add(family);
    }
    if(out.length<3)for(const item of pool){if(out.length>=3)break;if(!out.some(x=>x.key===item.key))out.push(item);}
    return out;
  };
  const topPredictions=diversify(topEligible);

  return {
    allMarkets: candidates,
    topPredictions,
    best: topPredictions[0] || null,
    bttsDirection: marketEvidenceService.bttsDirection(goalMarkets?.bttsPercent),
    valuePicks: valueEligible,
    selectionPolicy: {
      mode:'analysis-first-with-verified-value-overlay',
      topPicksRequireOdds:false,
      topPicksUseFreshOddsWhenAvailable:true,
      topPicksPriceSignal:'price-adjusted-model-support-with-devig-edge-and-ev',
      topPicksMinimumProbability:50,
      topPicksMinimumEvidenceReliability:.45,
      topPicksMinimumDataHealth:45,
      topPicksMinimumEffectiveSample:8,
      valueRequiresVerifiedOdds:true,
      valueRequiresFreshOdds:true,
      valueRequiresPositiveExpectedValue:true,
      valueUsesUncertaintyAdjustedEdge:true,
      noBetCustomerFacing:false,
      includedTopPickMarkets:['home','away','bttsYes','over25','homeOver15','homeOver25','homeOver35','awayOver15','awayOver25','awayOver35'],
      excludedMarkets:['draw','under25','bttsNo','shOver05'],
      modelHealthGate:healthGate,
      modelHealthReadiness:modelHealth?.readiness||'unavailable'
    },
  };
}

function buildDataHealth({ homePlayed, awayPlayed, hasOdds, hasStandings, injuriesAvailable, h2hCount }) {
  const homeSample = clamp(homePlayed / 5, 0, 1);
  const awaySample = clamp(awayPlayed / 5, 0, 1);
  const score = Math.round(
    homeSample * 25 +
    awaySample * 25 +
    (hasOdds ? 20 : 0) +
    (hasStandings ? 10 : 0) +
    (injuriesAvailable ? 10 : 0) +
    (h2hCount > 0 ? 10 : 0)
  );

  return {
    score,
    level: score >= 80 ? 'high' : score >= 55 ? 'medium' : 'low',
    sample: { home: homePlayed, away: awayPlayed, target: 5 },
    checks: {
      odds: hasOdds,
      standings: hasStandings,
      injuries: injuriesAvailable,
      h2h: h2hCount > 0,
    },
  };
}

function buildPremiumIntelligence({
  modelProbabilities,
  marketProbabilities,
  marketEvidence = {},
  matchOdds,
  homePlayed = 0,
  awayPlayed = 0,
  hasStandings = false,
  injuriesAvailable = false,
  h2hCount = 0,
  homeLambda = 0,
  awayLambda = 0,
  homeForm,
  awayForm,
}) {
  const hasOdds = !!(marketProbabilities && matchOdds);
  const dataHealth = buildDataHealth({
    homePlayed,
    awayPlayed,
    hasOdds,
    hasStandings,
    injuriesAvailable,
    h2hCount,
  });

  const modelChoices = OUTCOMES.map(outcome => ({
    outcome: outcome.key,
    modelProbability: Number(modelProbabilities?.[outcome.modelKey] || 0),
  })).sort((a, b) => b.modelProbability - a.modelProbability);
  const hasModel = modelChoices.some(choice => choice.modelProbability > 0);

  const edges = hasOdds
    ? OUTCOMES.map(outcome => {
        const model = Number(modelProbabilities?.[outcome.modelKey] || 0);
        const market = Number(marketProbabilities?.[outcome.marketKey] || 0);
        const odds = Number(matchOdds?.[outcome.oddsKey] || 0);
        const edgePoints = +(model - market).toFixed(1);
        return {
          outcome: outcome.key,
          modelProbability: model,
          marketProbability: market,
          edgePoints,
          odds,
          fairOdds: model > 0 ? +(100 / model).toFixed(2) : null,
          positive: edgePoints >= 3,
        };
      }).sort((a, b) => b.edgePoints - a.edgePoints)
    : [];

  const bestEdge = edges[0] || (hasModel ? {
    ...modelChoices[0],
    marketProbability: null,
    edgePoints: null,
    odds: null,
    fairOdds: modelChoices[0].modelProbability > 0 ? +(100 / modelChoices[0].modelProbability).toFixed(2) : null,
    positive: false,
  } : null);
  const minSample = Math.min(homePlayed, awayPlayed);
  const blockers = [];
  if (homePlayed < 5 || awayPlayed < 5) blockers.push('SMALL_SAMPLE');
  const selectionEvidence = bestEdge ? marketEvidence?.[bestEdge.outcome] : null;
  const evidenceReady = marketEvidenceService.hasStrongEvidence(selectionEvidence);
  if (!evidenceReady) blockers.push('INSUFFICIENT_MARKET_EVIDENCE');
  if (!hasOdds) blockers.push('NO_MARKET_ODDS');
  if (!hasStandings) blockers.push('NO_STANDINGS');
  if (dataHealth.score < 55) blockers.push('LOW_DATA_HEALTH');

  // A commercial prediction product must not turn league priors or sparse
  // evidence into a customer-facing pick. Keep the probabilities available for
  // diagnostics, but require a minimum completed sample and data-health floor
  // before publishing a selection.
  const decisionReady = hasModel && minSample >= 8 && evidenceReady && dataHealth.score >= 55;
  let status = decisionReady ? 'PICK' : 'UNAVAILABLE';
  if (decisionReady && hasOdds && bestEdge?.edgePoints >= 3) status = 'VALUE';

  const drivers = [];
  if (homeLambda > awayLambda + 0.35) drivers.push({ code: 'HOME_EXPECTED_GOALS_EDGE', strength: +(homeLambda - awayLambda).toFixed(2) });
  if (awayLambda > homeLambda + 0.35) drivers.push({ code: 'AWAY_EXPECTED_GOALS_EDGE', strength: +(awayLambda - homeLambda).toFixed(2) });
  if ((homeForm?.avgGoalsFor || 0) >= 1.5) drivers.push({ code: 'HOME_ATTACK_FORM', strength: homeForm.avgGoalsFor });
  if ((awayForm?.avgGoalsFor || 0) >= 1.5) drivers.push({ code: 'AWAY_ATTACK_FORM', strength: awayForm.avgGoalsFor });
  if ((homeForm?.avgGoalsAgainst || 0) >= 1.5) drivers.push({ code: 'HOME_DEFENCE_RISK', strength: homeForm.avgGoalsAgainst });
  if ((awayForm?.avgGoalsAgainst || 0) >= 1.5) drivers.push({ code: 'AWAY_DEFENCE_RISK', strength: awayForm.avgGoalsAgainst });

  return {
    version: 'premium-v2',
    status,
    selection: decisionReady ? (bestEdge?.outcome || null) : null,
    bestEdge,
    edges,
    dataHealth,
    blockers,
    drivers: drivers.slice(0, 4),
    methodology: {
      edgeUsesModelOnly: true,
      minimumValueEdgePoints: 3,
      minimumFullSample: 8,
      minimumMarketEvidenceLevel: 'SUFFICIENT',
      minimumEffectiveSample: 8,
      minimumDataHealth: 55,
      insufficientDataBlocksSelection: true,
    },
  };
}

module.exports = { buildPremiumIntelligence, buildDataHealth, buildMarketBoard };
