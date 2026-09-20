/**
 * Canli mac sirasinda gercek xG verisi cogu ucretsiz kaynakta yok.
 * Bu yuzden sut/korner/pozisyon sayisindan "yaklasik canli xG" turetiyoruz.
 * Kullaniciya "gercek xG" degil "canli gol beklentisi" olarak sunulmali.
 *
 * Agirliklar kaba bir yaklasimdir, gercek veriyle zamanla kalibre edilebilir.
 */
const WEIGHTS = {
  shotOnTarget: 0.10,
  shotOffTarget: 0.03,
  corner: 0.02,
  dangerousAttack: 0.015,
  blockedShot: 0.025,
  shotInsideBox: 0.06,
  bigChance: 0.12,
};

function estimateLiveXg(stats) {
  const fields = [
    ['shotsOnTarget','shotOnTarget'],['shotsOffTarget','shotOffTarget'],['corners','corner'],
    ['dangerousAttacks','dangerousAttack'],['blockedShots','blockedShot'],
    ['shotsInsideBox','shotInsideBox'],['bigChances','bigChance']
  ];
  let xg = 0, observed = 0;
  for (const [field, weight] of fields) {
    const v = stats?.[field];
    if (Number.isFinite(v)) { xg += v * WEIGHTS[weight]; observed++; }
  }
  return { value:+xg.toFixed(2), available:observed > 0, completeness:+(observed/fields.length*100).toFixed(0) };
}

/** Iki takimin canli istatistiginden momentum yuzdesi (kim baski kuruyor) */
function calculateMomentum(homeStats, awayStats) {
  const hx = estimateLiveXg(homeStats), ax = estimateLiveXg(awayStats);
  if (!hx.available && !ax.available) return { home:null, away:null, available:false };
  const homeXg = hx.value, awayXg = ax.value;
  const total = homeXg + awayXg;

  if (total === 0) return { home:null, away:null, available:false };

  return {
    home: +((homeXg / total) * 100).toFixed(1),
    away: +((awayXg / total) * 100).toFixed(1),
    available: true,
  };
}

/**
 * "Hangi takim gole daha yakin" yuzdesi.
 * Momentumdan farkli olarak sadece genel baskiyi degil, gol atma
 * potansiyeli tasiyan aksiyonlari agirlikli olarak hesaba katar:
 * isabetli sut en cok, tehlikeli atak ve korner daha az agirlikli.
 * Ayrica canli xG'nin kendisini de dahil ederek son birkac dakikanin
 * degil, mac genelindeki gol yakinligini yansitir.
 */
const GOAL_PROXIMITY_WEIGHTS = {
  shotsOnTarget: 3,
  dangerousAttacks: 0.4,
  corners: 0.8,
  liveXg: 12,
  blockedShots: 0.7,
  shotsInsideBox: 1.4,
  bigChances: 3.2,
};

function calculateGoalProximity(homeStats, awayStats, homeLiveXg, awayLiveXg, context = {}) {
  const score = (stats, liveXg) =>
    (stats.shotsOnTarget || 0) * GOAL_PROXIMITY_WEIGHTS.shotsOnTarget +
    (stats.dangerousAttacks || 0) * GOAL_PROXIMITY_WEIGHTS.dangerousAttacks +
    (stats.corners || 0) * GOAL_PROXIMITY_WEIGHTS.corners +
    (stats.blockedShots || 0) * GOAL_PROXIMITY_WEIGHTS.blockedShots +
    (stats.shotsInsideBox || 0) * GOAL_PROXIMITY_WEIGHTS.shotsInsideBox +
    (stats.bigChances || 0) * GOAL_PROXIMITY_WEIGHTS.bigChances +
    (liveXg || 0) * GOAL_PROXIMITY_WEIGHTS.liveXg;

  let homeScore = score(homeStats, homeLiveXg);
  let awayScore = score(awayStats, awayLiveXg);

  // Small bounded context adjustments. Possession only counts when both values
  // are actually observed; red cards are explicit match-state penalties.
  if (Number.isFinite(context.possessionHome) && Number.isFinite(context.possessionAway)) {
    const diff = Math.max(-20, Math.min(20, context.possessionHome - context.possessionAway));
    homeScore *= 1 + diff * 0.003;
    awayScore *= 1 - diff * 0.003;
  }
  const hr = Math.max(0, Number(context.redCardsHome || 0));
  const ar = Math.max(0, Number(context.redCardsAway || 0));
  if (hr) homeScore *= Math.max(0.55, 1 - 0.18 * hr);
  if (ar) awayScore *= Math.max(0.55, 1 - 0.18 * ar);
  const minute = Number(context.minute);
  const hs = Number(context.homeScore), as = Number(context.awayScore);
  if (Number.isFinite(minute) && minute > 0) {
    const urgency = Math.max(0, Math.min(1, (minute - 45) / 45));
    if (Number.isFinite(hs) && Number.isFinite(as) && hs !== as) {
      if (hs < as) homeScore *= 1 + 0.10 * urgency;
      else awayScore *= 1 + 0.10 * urgency;
    }
  }
  const total = homeScore + awayScore;
  if (total === 0) return { home:null, away:null, available:false };

  return {
    home: +((homeScore / total) * 100).toFixed(1),
    away: +((awayScore / total) * 100).toFixed(1),
    available: true,
  };
}

/**
 * Canli value alert: mac sirasindaki guncel modelin, piyasa oranindan
 * anlamli sapip sapmadigini kontrol eder.
 */
function checkLiveValueAlert(liveModelProbability, currentMarketOdds, threshold = 0.05) {
  const impliedProb = 1 / currentMarketOdds;
  const edge = liveModelProbability - impliedProb;
  return {
    edge: +edge.toFixed(3),
    triggered: edge > threshold,
    message: edge > threshold
      ? `Model tahmini piyasa oranindan %${(edge * 100).toFixed(1)} daha yuksek`
      : null,
  };
}

module.exports = { estimateLiveXg, calculateMomentum, calculateGoalProximity, checkLiveValueAlert };
