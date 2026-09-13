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
};

function estimateLiveXg(stats) {
  // stats: { shotsOnTarget, shotsOffTarget, corners, dangerousAttacks }
  const xg =
    (stats.shotsOnTarget || 0) * WEIGHTS.shotOnTarget +
    (stats.shotsOffTarget || 0) * WEIGHTS.shotOffTarget +
    (stats.corners || 0) * WEIGHTS.corner +
    (stats.dangerousAttacks || 0) * WEIGHTS.dangerousAttack;

  return +xg.toFixed(2);
}

/** Iki takimin canli istatistiginden momentum yuzdesi (kim baski kuruyor) */
function calculateMomentum(homeStats, awayStats) {
  const homeXg = estimateLiveXg(homeStats);
  const awayXg = estimateLiveXg(awayStats);
  const total = homeXg + awayXg;

  if (total === 0) return { home: 50, away: 50 };

  return {
    home: +((homeXg / total) * 100).toFixed(1),
    away: +((awayXg / total) * 100).toFixed(1),
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
  liveXg: 8,
};

function calculateGoalProximity(homeStats, awayStats, homeLiveXg, awayLiveXg) {
  const score = (stats, liveXg) =>
    (stats.shotsOnTarget || 0) * GOAL_PROXIMITY_WEIGHTS.shotsOnTarget +
    (stats.dangerousAttacks || 0) * GOAL_PROXIMITY_WEIGHTS.dangerousAttacks +
    (stats.corners || 0) * GOAL_PROXIMITY_WEIGHTS.corners +
    (liveXg || 0) * GOAL_PROXIMITY_WEIGHTS.liveXg;

  const homeScore = score(homeStats, homeLiveXg);
  const awayScore = score(awayStats, awayLiveXg);
  const total = homeScore + awayScore;

  if (total === 0) {
    return { home: 50, away: 50 };
  }

  return {
    home: +((homeScore / total) * 100).toFixed(1),
    away: +((awayScore / total) * 100).toFixed(1),
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
