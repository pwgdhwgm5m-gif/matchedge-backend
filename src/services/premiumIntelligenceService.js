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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function buildMarketBoard({ modelProbabilities, goalMarkets, cornerMetrics, halfMarkets, dataHealth, premium, sportmonksIntel, sportmonksMarketEvidence, evidenceStrength=0.5, modelAgreementScore=50 }) {
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
    { key: 'bttsYes', market: 'KG', label: 'KG Var', probability: Number(goalMarkets?.bttsPercent || 0) },
    { key: 'bttsNo', market: 'KG', label: 'KG Yok', probability: 100 - Number(goalMarkets?.bttsPercent || 0) },
    { key: 'cornersOver95', market: 'KORNER', label: '9.5 Üst Korner', probability: Number(cornerMetrics?.over95Percent || 0) },
    { key: 'cornersUnder95', market: 'KORNER', label: '9.5 Alt Korner', probability: Number(cornerMetrics?.under95Percent ?? (100 - Number(cornerMetrics?.over95Percent || 0))) },
    { key: 'fhHome', market: 'İLK YARI', label: 'Ev Sahibi', probability: Number(halfMarkets?.firstHalf?.home || 0) },
    { key: 'fhDraw', market: 'İLK YARI', label: 'Beraberlik', probability: Number(halfMarkets?.firstHalf?.draw || 0) },
    { key: 'fhAway', market: 'İLK YARI', label: 'Deplasman', probability: Number(halfMarkets?.firstHalf?.away || 0) },
    { key: 'shHome', market: 'İKİNCİ YARI', label: 'Ev Sahibi', probability: Number(halfMarkets?.secondHalf?.home || 0) },
    { key: 'shDraw', market: 'İKİNCİ YARI', label: 'Beraberlik', probability: Number(halfMarkets?.secondHalf?.draw || 0) },
    { key: 'shAway', market: 'İKİNCİ YARI', label: 'Deplasman', probability: Number(halfMarkets?.secondHalf?.away || 0) },
    { key: 'mostGoalsFirst', market: 'EN GOLLÜ YARI', label: 'İlk Yarı', probability: Number(halfMarkets?.mostGoalsHalf?.first || 0) },
    { key: 'mostGoalsEqual', market: 'EN GOLLÜ YARI', label: 'Eşit', probability: Number(halfMarkets?.mostGoalsHalf?.equal || 0) },
    { key: 'mostGoalsSecond', market: 'EN GOLLÜ YARI', label: 'İkinci Yarı', probability: Number(halfMarkets?.mostGoalsHalf?.second || 0) },
  ].filter(item => Number.isFinite(item.probability) && item.probability > 0 && item.probability < 100)
    .map(item => {
      const ev=sportmonksMarketEvidence||{};
      let evidence=null;
      if(item.market==='1X2') evidence=item.key==='home'?ev.homeThreat:item.key==='away'?ev.awayThreat:(ev.homeThreat!=null&&ev.awayThreat!=null?1-Math.min(.25,Math.abs(ev.homeThreat-ev.awayThreat)*.35):null);
      else if(item.key==='over25') evidence=ev.goalQuality;
      else if(item.key==='under25') evidence=ev.goalQuality!=null?2-ev.goalQuality:null;
      else if(item.key==='bttsYes') evidence=ev.bttsQuality;
      else if(item.key==='bttsNo') evidence=ev.bttsQuality!=null?2-ev.bttsQuality:null;
      else if(item.market==='KORNER') evidence=item.key==='cornersOver95'?ev.cornerQuality:(ev.cornerQuality!=null?2-ev.cornerQuality:null);
      const evidenceBonus=evidence==null?0:clamp((evidence-1)*12,-4,4);
      // Rank markets by their own evidence quality. A high headline probability
      // should not outrank a better-supported market merely because it is more
      // extreme. 1X2 may use 1X2 agreement; binary/corner markets do not inherit it.
      const baseEvidence=clamp(Number(evidenceStrength)||0,.25,1);
      const marketEvidence=evidence==null?baseEvidence:clamp(baseEvidence*(.75+.25*clamp(evidence,.65,1.35)),.25,1);
      const agreementFactor=item.market==='1X2'?clamp(Number(modelAgreementScore)||0,0,100)/100:1;
      const reliability=clamp(marketEvidence*(item.market==='1X2'?(.75+.25*agreementFactor):1),.25,1);
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

  // Top picks should be useful alternatives, not three correlated expressions
  // of the same underlying signal. Keep one selection per market family first,
  // then fill remaining slots only if necessary.
  const diversified=[];
  const usedMarkets=new Set();
  for(const item of candidates){
    if(diversified.length>=3)break;
    if(usedMarkets.has(item.market))continue;
    // Require both a meaningful probability edge and minimum evidence support.
    // Weak-data extremes remain visible in allMarkets but cannot become a top pick.
    if(item.probability < 54 || item.evidenceReliability < .40)continue;
    diversified.push(item);usedMarkets.add(item.market);
  }
  if(diversified.length<3){
    for(const item of candidates){
      if(diversified.length>=3)break;
      if(diversified.some(x=>x.key===item.key))continue;
      if(item.probability < 56 || item.evidenceReliability < .50)continue;
      diversified.push(item);
    }
  }

  return {
    allMarkets: candidates,
    topPredictions: diversified,
    best: (health >= 45 ? diversified[0] || null : null),
    valuePicks: candidates.filter(item => item.isValue),
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
  if (!hasOdds) blockers.push('NO_MARKET_ODDS');
  if (!hasStandings) blockers.push('NO_STANDINGS');
  if (dataHealth.score < 55) blockers.push('LOW_DATA_HEALTH');

  // Keep data-quality/sample issues as transparent warnings, but do not block
  // the model's selection. The user decides whether to act on the probabilities.
  let status = hasModel ? 'PICK' : 'UNAVAILABLE';
  if (hasOdds && bestEdge?.edgePoints >= 3) status = 'VALUE';

  const drivers = [];
  if (homeLambda > awayLambda + 0.35) drivers.push({ code: 'HOME_XG_EDGE', strength: +(homeLambda - awayLambda).toFixed(2) });
  if (awayLambda > homeLambda + 0.35) drivers.push({ code: 'AWAY_XG_EDGE', strength: +(awayLambda - homeLambda).toFixed(2) });
  if ((homeForm?.avgGoalsFor || 0) >= 1.5) drivers.push({ code: 'HOME_ATTACK_FORM', strength: homeForm.avgGoalsFor });
  if ((awayForm?.avgGoalsFor || 0) >= 1.5) drivers.push({ code: 'AWAY_ATTACK_FORM', strength: awayForm.avgGoalsFor });
  if ((homeForm?.avgGoalsAgainst || 0) >= 1.5) drivers.push({ code: 'HOME_DEFENCE_RISK', strength: homeForm.avgGoalsAgainst });
  if ((awayForm?.avgGoalsAgainst || 0) >= 1.5) drivers.push({ code: 'AWAY_DEFENCE_RISK', strength: awayForm.avgGoalsAgainst });

  return {
    version: 'premium-v2',
    status,
    selection: bestEdge?.outcome || null,
    bestEdge,
    edges,
    dataHealth,
    blockers,
    drivers: drivers.slice(0, 4),
    methodology: {
      edgeUsesModelOnly: true,
      minimumValueEdgePoints: 3,
      minimumFullSample: 5,
    },
  };
}

module.exports = { buildPremiumIntelligence, buildDataHealth, buildMarketBoard };
