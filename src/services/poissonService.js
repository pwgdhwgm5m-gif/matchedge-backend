/**
 * Poisson dagilimi ile futbol mac analizi.
 * Girdi: iki takimin gol beklentisi (xG benzeri, ev/deplasman etkisi dahil).
 */

function factorial(n) {
  return n <= 1 ? 1 : n * factorial(n - 1);
}

function poissonProbability(lambda, k) {
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

/**
 * Dixon-Coles duzeltme faktoru (tau).
 * Bagimsiz Poisson varsayimi, ozellikle dusuk skorlu maclarda
 * (0-0, 1-0, 0-1, 1-1) gercek verilerden hafifce sapar - bu skorlar
 * gercekte modelin ongordugunden biraz daha sik/az cikar. Dixon & Coles
 * (1997) makalesindeki duzeltme, sadece bu 4 dusuk skor icin carpan uygular.
 * rho tipik olarak -0.05 ile -0.15 arasinda kucuk negatif bir degerdir;
 * gercek deger lige gore backtesting ile kalibre edilebilir (bkz. sohbet).
 */
const DEFAULT_RHO = -0.13;

function dixonColesTau(x, y, lambda, mu, rho) {
  if (x === 0 && y === 0) return 1 - (lambda * mu * rho);
  if (x === 0 && y === 1) return 1 + (lambda * rho);
  if (x === 1 && y === 0) return 1 + (mu * rho);
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}

/**
 * Dixon-Coles duzeltmesi uygulanmis, normalize edilmis skor matrisi.
 * calculateMatchProbabilities ve calculateMarketProbabilities artik
 * ham Poisson yerine bu matrisi kullaniyor.
 */
function buildScoreMatrix(homeLambda, awayLambda, maxGoals = 6, rho = DEFAULT_RHO) {
  const matrix = [];
  let total = 0;

  for (let h = 0; h <= maxGoals; h++) {
    const row = [];
    for (let a = 0; a <= maxGoals; a++) {
      let p = poissonProbability(homeLambda, h) * poissonProbability(awayLambda, a);
      p *= dixonColesTau(h, a, homeLambda, awayLambda, rho);
      p = Math.max(0, p); // guvenlik: tau cok dusuk lambda ile teorik olarak negatife kayabilir
      row.push(p);
      total += p;
    }
    matrix.push(row);
  }

  // Tau duzeltmesi toplam olasiligi hafifce 1'den kaydirir, yeniden normalize ediyoruz
  if (total > 0) {
    for (let h = 0; h <= maxGoals; h++) {
      for (let a = 0; a <= maxGoals; a++) {
        matrix[h][a] = matrix[h][a] / total;
      }
    }
  }

  return matrix;
}

/**
 * Takim gucu (attack/defense rating) uzerinden beklenen gol (lambda) hesaplar.
 * @param {number} teamAttack - takimin lig ortalamasina gore hucum gucu (orn. 1.3 = ortalamanin %30 ustu)
 * @param {number} opponentDefense - rakibin savunma zayifligi (orn. 1.1 = ortalamadan %10 kotu savunma)
 * @param {number} leagueAvgGoals - ligin mac basi ortalama gol sayisi (genelde ~1.4 ev, ~1.1 deplasman)
 * @param {number} homeAdvantage - ev sahibi carpani (varsayilan 1.15)
 */
function calculateExpectedGoals(teamAttack, opponentDefense, leagueAvgGoals, homeAdvantage = 1) {
  return +(teamAttack * opponentDefense * leagueAvgGoals * homeAdvantage).toFixed(2);
}

/**
 * Iki takimin lambda (beklenen gol) degerlerinden tam skor matrisi ve
 * mac sonucu olasiliklarini (1-X-2) hesaplar.
 * @param {number} homeLambda
 * @param {number} awayLambda
 * @param {number} maxGoals - olasilik matrisinde kac gole kadar hesaplansin (varsayilan 6)
 */
function calculateMatchProbabilities(homeLambda, awayLambda, maxGoals = 10, rho = DEFAULT_RHO) {
  const scoreMatrix = buildScoreMatrix(homeLambda, awayLambda, maxGoals, rho);
  let homeWin = 0, draw = 0, awayWin = 0;

  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const p = scoreMatrix[h][a];
      if (h > a) homeWin += p;
      else if (h === a) draw += p;
      else awayWin += p;
    }
  }

  return {
    homeWinProbability: +(homeWin * 100).toFixed(1),
    drawProbability: +(draw * 100).toFixed(1),
    awayWinProbability: +(awayWin * 100).toFixed(1),
    scoreMatrix: scoreMatrix.map(row => row.map(p => +p.toFixed(4))),
  };
}

/** 2.5 ust/alt, KG var/yok gibi market bazli olasiliklar */
function calculateMarketProbabilities(homeLambda, awayLambda, maxGoals = 10, rho = DEFAULT_RHO) {
  const scoreMatrix = buildScoreMatrix(homeLambda, awayLambda, maxGoals, rho);
  let over25 = 0, btts = 0;

  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const p = scoreMatrix[h][a];
      if (h + a > 2.5) over25 += p;
      if (h > 0 && a > 0) btts += p;
    }
  }

  return {
    over25GoalsPercent: +(over25 * 100).toFixed(1),
    bttsPercent: +(btts * 100).toFixed(1),
  };
}

function calculateHalfMarkets(homeLambda, awayLambda) {
  const firstHalf = calculateMatchProbabilities(homeLambda * 0.45, awayLambda * 0.45, 5);
  const secondHalf = calculateMatchProbabilities(homeLambda * 0.55, awayLambda * 0.55, 5);
  const firstTotal = (homeLambda + awayLambda) * 0.45;
  const secondTotal = (homeLambda + awayLambda) * 0.55;
  let firstMore = 0, secondMore = 0, equal = 0;
  for (let first = 0; first <= 6; first++) {
    for (let second = 0; second <= 6; second++) {
      const p = poissonProbability(firstTotal, first) * poissonProbability(secondTotal, second);
      if (first > second) firstMore += p; else if (second > first) secondMore += p; else equal += p;
    }
  }
  const total = firstMore + secondMore + equal || 1;
  return {
    firstHalf: {
      home: firstHalf.homeWinProbability, draw: firstHalf.drawProbability, away: firstHalf.awayWinProbability,
    },
    secondHalf: {
      home: secondHalf.homeWinProbability, draw: secondHalf.drawProbability, away: secondHalf.awayWinProbability,
    },
    mostGoalsHalf: {
      first: +((firstMore / total) * 100).toFixed(1),
      equal: +((equal / total) * 100).toFixed(1),
      second: +((secondMore / total) * 100).toFixed(1),
    },
  };
}

/** En guclu sinyali ve guven skorunu belirler (mockup'taki "En Guclu Sinyal" karti) */
function findStrongestSignal(markets) {
  // markets: [{ label: '2.5 Ust Gol', probability: 58.2 }, ...]
  const sorted = [...markets].sort((a, b) => b.probability - a.probability);
  const top = sorted[0];
  const confidence = +(top.probability / 35).toFixed(2); // basit normalize edilmis guven skoru
  return {
    label: top.label,
    probability: top.probability,
    confidenceScore: confidence,
    isStrong: top.probability >= 55,
  };
}

/**
 * Veri kalitesi skoru (mockup'taki "91/100").
 * Kac kaynaktan basarili veri geldigi + verinin yasina gore hesaplanir.
 * @param {number} successfulSources - basarili donen kaynak sayisi
 * @param {number} totalSources - toplam denenen kaynak sayisi
 * @param {number} dataAgeMinutes - en eski verinin kac dakika once cekildigi
 */
function calculateDataQualityScore(successfulSources, totalSources, dataAgeMinutes) {
  const sourceScore = (successfulSources / totalSources) * 70; // kaynak basari orani agirlik: 70
  const freshnessScore = Math.max(0, 30 - dataAgeMinutes); // her dakika bayatlama -1 puan, agirlik: 30
  const total = Math.round(sourceScore + freshnessScore);
  return Math.min(100, Math.max(0, total));
}

/**
 * Beklenen korner tahmini.
 * NOT: Gercek korner istatistigi (takimlarin gecmis mac korner ortalamasi)
 * fixture basina ayri bir API cagrisi gerektiriyor - kota maliyeti yuksek.
 * Bunun yerine zaten hesaplanmis beklenen gol (lambda) degerlerinden,
 * mac temposunun korner sayisiyla genelde orantili oldugu varsayimiyla
 * bir TAHMIN uretiyoruz. Bu gercek istatistik degil, turetilmis bir
 * yaklasimdir - ileride gercek korner verisiyle kalibre edilebilir.
 */
function estimateCornerMetricsFromExpected(homeExpected, awayExpected) {
  const expectedTotal = Math.max(0.5, Number(homeExpected || 0) + Number(awayExpected || 0));
  let cumulative85 = 0, cumulative95 = 0;
  for (let k = 0; k <= 9; k++) {
    const p = poissonProbability(expectedTotal, k);
    if (k <= 8) cumulative85 += p;
    cumulative95 += p;
  }
  const over85Percent = +((1 - cumulative85) * 100).toFixed(1);
  const over95Percent = +((1 - cumulative95) * 100).toFixed(1);
  const homeShare = expectedTotal ? Number(homeExpected || 0) / expectedTotal : 0.5;
  return { expectedTotal:+expectedTotal.toFixed(1), minExpected:Math.max(0,Math.floor(expectedTotal-2)),
    over95Percent:Math.max(0,Math.min(100,over95Percent)), under95Percent:Math.max(0,Math.min(100,+(100-over95Percent).toFixed(1))),
    over85Percent:Math.max(0,Math.min(100,over85Percent)), homeShare:+(homeShare*100).toFixed(1), awayShare:+((1-homeShare)*100).toFixed(1), source:'historical-corners' };
}

function estimateCornerMetrics(homeLambda, awayLambda) {
  const totalGoalExpectation = homeLambda + awayLambda;
  const leagueAvgGoals = 2.5; // referans lig ortalamasi
  const baseTotalCorners = 9.5; // ligler arasi tipik toplam korner ortalamasi

  const intensityRatio = totalGoalExpectation / leagueAvgGoals;
  const expectedTotal = +(baseTotalCorners * intensityRatio).toFixed(1);

  // Muhafazakar alt sinir: beklenen degerin ~2.5 altini "guvenli minimum" sayiyoruz
  const minExpected = Math.max(4, Math.round(expectedTotal - 2.5));

  // Ana korner marketi 9.5. 8.5 alani sadece eski kayitlarla geriye uyumluluk icin korunur.
  let cumulative85 = 0, cumulative95 = 0;
  for (let k = 0; k <= 9; k++) {
    const p = poissonProbability(expectedTotal, k);
    if (k <= 8) cumulative85 += p;
    cumulative95 += p;
  }
  const over85Percent = +((1 - cumulative85) * 100).toFixed(1);
  const over95Percent = +((1 - cumulative95) * 100).toFixed(1);

  const homeShare = totalGoalExpectation ? homeLambda / totalGoalExpectation : 0.5;

  return {
    expectedTotal,
    minExpected,
    over95Percent: Math.max(0, Math.min(100, over95Percent)),
    under95Percent: Math.max(0, Math.min(100, +(100 - over95Percent).toFixed(1))),
    over85Percent: Math.max(0, Math.min(100, over85Percent)),
    homeShare: +(homeShare * 100).toFixed(1),
    awayShare: +((1 - homeShare) * 100).toFixed(1),
  };
}


function estimateLeagueParameters(fixtures, options={}) {
  const now=Number(options.now||Date.now()), halfLifeDays=Math.max(45,Number(options.halfLifeDays||240));
  const rows=(fixtures||[]).filter(f=>f?.goals?.home!=null&&f?.goals?.away!=null&&Number.isFinite(Number(f.goals.home))&&Number.isFinite(Number(f.goals.away)));
  let wh=0,wa=0,w=0;
  const weighted=[];
  for(const f of rows){
    const t=new Date(f.fixture?.date||f.date||now).getTime(),age=Math.max(0,(now-t)/86400000),wt=Math.pow(.5,age/halfLifeDays),h=Number(f.goals.home),a=Number(f.goals.away);
    wh+=wt*h;wa+=wt*a;w+=wt;weighted.push({h,a,wt});
  }
  const homeAvg=w?wh/w:1.45,awayAvg=w?wa/w:1.15,homeAdvantage=clamp(homeAvg/Math.max(.65,awayAvg),.92,1.35);
  // Fit rho against the four Dixon-Coles low-score cells using weighted
  // maximum likelihood. League averages are used as stable baseline lambdas;
  // recency weights make the estimate responsive without overreacting.
  let rho=DEFAULT_RHO,fitLogLikelihood=null;
  if(weighted.length>=20){
    let best=-Infinity,bestRho=DEFAULT_RHO;
    for(let r=-.25;r<=.10+1e-9;r+=.0025){
      let ll=0,valid=true;
      for(const x of weighted){
        if(x.h>1||x.a>1)continue;
        const tau=dixonColesTau(x.h,x.a,homeAvg,awayAvg,r);
        if(!(tau>0)||!Number.isFinite(tau)){valid=false;break;}
        ll+=x.wt*Math.log(tau);
      }
      if(valid&&ll>best){best=ll;bestRho=r;}
    }
    rho=clamp(bestRho,-.25,.10);fitLogLikelihood=Number.isFinite(best)?+best.toFixed(4):null;
  }
  return {rho:+rho.toFixed(4),homeAdvantage:+homeAdvantage.toFixed(4),homeAvg:+homeAvg.toFixed(3),awayAvg:+awayAvg.toFixed(3),sample:rows.length,halfLifeDays,rhoMethod:weighted.length>=20?'weighted-low-score-mle':'default-small-sample',fitLogLikelihood};
}

module.exports = {
  calculateExpectedGoals,
  calculateMatchProbabilities,
  calculateMarketProbabilities,
  calculateHalfMarkets,
  findStrongestSignal,
  calculateDataQualityScore,
  estimateCornerMetrics,
  estimateCornerMetricsFromExpected,
  buildScoreMatrix,
  dixonColesTau,
  DEFAULT_RHO,
  estimateLeagueParameters,
};
