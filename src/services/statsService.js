/**
 * Genel form yerine "evindeyken nasil, deplasmandayken nasil"
 * ayrimini cikarir. Bir takim evinde çok iyi, deplasmanda kotu
 * olabilir - genel form ortalamasi bunu gizler.
 */

function summarizeMatches(matches, teamId) {
  let wins = 0, draws = 0, losses = 0, goalsFor = 0, goalsAgainst = 0;
  let played = 0;

  matches.forEach(m => {
    const homeScore = validScore(m?.goals?.home);
    const awayScore = validScore(m?.goals?.away);
    if (homeScore === null || awayScore === null) return;
    const isHome = String(m?.teams?.home?.id) === String(teamId);
    if (!isHome && String(m?.teams?.away?.id) !== String(teamId)) return;
    const gf = isHome ? homeScore : awayScore;
    const ga = isHome ? awayScore : homeScore;
    played++;

    goalsFor += gf;
    goalsAgainst += ga;
    if (gf > ga) wins++;
    else if (gf === ga) draws++;
    else losses++;
  });

  return {
    played,
    wins,
    draws,
    losses,
    avgGoalsFor: played ? +(goalsFor / played).toFixed(2) : null,
    avgGoalsAgainst: played ? +(goalsAgainst / played).toFixed(2) : null,
  };
}

function validScore(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function calculateHalfHistory(fixtures, teamId) {
  let halftimeSamples = 0;
  let secondHalfSamples = 0;
  let firstHalfGoalsFor = 0;
  let firstHalfGoalsAgainst = 0;
  let secondHalfGoalsFor = 0;
  let secondHalfGoalsAgainst = 0;

  for (const fixture of fixtures || []) {
    const homeId = fixture?.teams?.home?.id;
    const awayId = fixture?.teams?.away?.id;
    const isHome = String(homeId) === String(teamId);
    const isAway = String(awayId) === String(teamId);
    if (!isHome && !isAway) continue;

    const htHome = validScore(fixture?.score?.halftime?.home);
    const htAway = validScore(fixture?.score?.halftime?.away);
    if (htHome === null || htAway === null) continue;

    halftimeSamples++;
    firstHalfGoalsFor += isHome ? htHome : htAway;
    firstHalfGoalsAgainst += isHome ? htAway : htHome;

    const ftHome = validScore(fixture?.goals?.home);
    const ftAway = validScore(fixture?.goals?.away);
    if (ftHome === null || ftAway === null || ftHome < htHome || ftAway < htAway) continue;

    secondHalfSamples++;
    secondHalfGoalsFor += isHome ? ftHome - htHome : ftAway - htAway;
    secondHalfGoalsAgainst += isHome ? ftAway - htAway : ftHome - htHome;
  }

  return {
    halftimeSamples,
    firstHalfScoringSamples: halftimeSamples,
    firstHalfConcedingSamples: halftimeSamples,
    secondHalfSamples,
    secondHalfScoringSamples: secondHalfSamples,
    secondHalfConcedingSamples: secondHalfSamples,
    firstHalfGoalsFor: halftimeSamples ? +(firstHalfGoalsFor / halftimeSamples).toFixed(2) : null,
    firstHalfGoalsAgainst: halftimeSamples ? +(firstHalfGoalsAgainst / halftimeSamples).toFixed(2) : null,
    secondHalfGoalsFor: secondHalfSamples ? +(secondHalfGoalsFor / secondHalfSamples).toFixed(2) : null,
    secondHalfGoalsAgainst: secondHalfSamples ? +(secondHalfGoalsAgainst / secondHalfSamples).toFixed(2) : null,
  };
}

/**
 * Ayni maclarin gol ortalamasini, en son maca en yuksek agirligi
 * verecek sekilde (ustel azalma) hesaplar. Bir takimin son 1-2 maci,
 * 5 mac onceki performansindan cok daha fazla bilgi tasir - duz
 * ortalama bu farki gormezden geliyordu.
 *
 * @param {number} decayFactor - 0-1 arasi. 1'e yakinsa tum maclar esit
 *   agirlikli (duz ortalamaya yaklasir), 0'a yakinsa sadece son mac onemli.
 *   0.85 gibi bir deger dengeli bir "form" hassasiyeti verir.
 */
function calculateWeightedGoalAverages(matches, teamId, decayFactor = 0.85) {
  // Once tarihe gore eskiden yeniye sirala, boylece agirliklandirma dogru calisir
  const sorted = [...matches]
    .filter(m => validScore(m?.goals?.home) !== null && validScore(m?.goals?.away) !== null)
    .sort((a, b) => new Date(a.fixture.date) - new Date(b.fixture.date));

  if (sorted.length === 0) {
    return { avgGoalsFor: null, avgGoalsAgainst: null, matchesConsidered: 0 };
  }

  let weightedFor = 0, weightedAgainst = 0, totalWeight = 0;
  const n = sorted.length;

  sorted.forEach((m, i) => {
    // i=0 en eski mac, i=n-1 en yeni mac. En yeniye agirlik 1, geriye dogru azalir.
    const weight = Math.pow(decayFactor, n - 1 - i);
    const isHome = String(m.teams.home.id) === String(teamId);
    const gf = isHome ? m.goals.home : m.goals.away;
    const ga = isHome ? m.goals.away : m.goals.home;

    weightedFor += gf * weight;
    weightedAgainst += ga * weight;
    totalWeight += weight;
  });

  return {
    avgGoalsFor: +(weightedFor / totalWeight).toFixed(2),
    avgGoalsAgainst: +(weightedAgainst / totalWeight).toFixed(2),
    matchesConsidered: n,
  };
}

/**
 * @param {Array} fixtures - takimin son N macinin fixture listesi (API-Football formatinda)
 * @param {number|string} teamId
 * @param {number} count - her kategoriden (ev/deplasman) kac mac dikkate alinsin
 */
function splitHomeAwayForm(fixtures, teamId, count = 5) {
  const homeMatches = fixtures
    .filter(f => String(f.teams.home.id) === String(teamId))
    .slice(0, count);
  const awayMatches = fixtures
    .filter(f => String(f.teams.away.id) === String(teamId))
    .slice(0, count);

  return {
    home: {
      ...summarizeMatches(homeMatches, teamId),
      ...calculateWeightedGoalAverages(homeMatches, teamId),
    },
    away: {
      ...summarizeMatches(awayMatches, teamId),
      ...calculateWeightedGoalAverages(awayMatches, teamId),
    },
  };
}

/**
 * Bir takimin gecmis maclarinda ilk yaride gol atma oranini hesaplar.
 * fixtures listesi API-Football'un standart /fixtures formatinda -
 * "score.halftime" alani zaten bu yanitin icinde geliyor, ekstra
 * API cagrisi gerekmiyor.
 */
function calculateFirstHalfTendency(fixtures, teamId) {
  let scored = 0, total = 0;

  fixtures.forEach(f => {
    const ht = f.score?.halftime;
    if (!ht || validScore(ht.home) === null || validScore(ht.away) === null) return; // veri yoksa atla
    const isHome = String(f.teams.home.id) === String(teamId);
    const teamHtGoals = isHome ? ht.home : ht.away;
    total++;
    if (teamHtGoals > 0) scored++;
  });

  return {
    matchesConsidered: total,
    firstHalfScoringSamples: total,
    firstHalfScoringRate: total ? +((scored / total) * 100).toFixed(1) : null,
  };
}

/**
 * Iki takimin H2H maclarindaki ilk yari gol egilimini cikarir.
 * Recency agirlikli: 5 yil onceki bir eslesme bugunku kadrolarla
 * pek alakali degildir, bu yuzden en son H2H maclarina daha fazla
 * agirlik veriyoruz (ayni ustel azalma mantigi, form hesabinda oldugu gibi).
 */
function calculateH2HFirstHalfTendency(h2hFixtures, homeTeamId, awayTeamId, decayFactor = 0.85) {
  const sorted = [...h2hFixtures]
    .filter(f => validScore(f.score?.halftime?.home) !== null && validScore(f.score?.halftime?.away) !== null)
    .sort((a, b) => new Date(a.fixture.date) - new Date(b.fixture.date));

  const total = sorted.length;
  if (total === 0) return { total: 0, homeRate: 50, awayRate: 50 };

  let homeWeighted = 0, awayWeighted = 0, totalWeight = 0;

  sorted.forEach((f, i) => {
    const weight = Math.pow(decayFactor, total - 1 - i);
    const ht = f.score.halftime;
    const homeWasHome = String(f.teams.home.id) === String(homeTeamId);
    const homeTeamScored = (homeWasHome ? ht.home : ht.away) > 0;
    const awayTeamScored = (homeWasHome ? ht.away : ht.home) > 0;

    if (homeTeamScored) homeWeighted += weight;
    if (awayTeamScored) awayWeighted += weight;
    totalWeight += weight;
  });

  return {
    total,
    homeRate: +((homeWeighted / totalWeight) * 100).toFixed(1),
    awayRate: +((awayWeighted / totalWeight) * 100).toFixed(1),
  };
}

/**
 * Takimlarin kendi gecmisi (agirlikli) ve H2H egilimini (H2H orneklemi
 * yeterince buyukse) birlestirip "ilk yari golune kim daha yakin"
 * yuzdesini uretir.
 */
function combineFirstHalfProximity(homeOwnRate, awayOwnRate, h2h) {
  const h2hSampleSize = h2h?.total || 0;
  const h2hWeight = h2hSampleSize >= 3 ? 0.3 : 0;
  const ownWeight = 1 - h2hWeight;

  const homeScore = (homeOwnRate ?? 50) * ownWeight + (h2h?.homeRate ?? 50) * h2hWeight;
  const awayScore = (awayOwnRate ?? 50) * ownWeight + (h2h?.awayRate ?? 50) * h2hWeight;
  const total = homeScore + awayScore || 1;

  return {
    home: +((homeScore / total) * 100).toFixed(1),
    away: +((awayScore / total) * 100).toFixed(1),
    h2hSampleSize,
  };
}

/**
 * Eksik oyuncu (sakatlik/ceza) sayisina gore kaba bir performans cezasi.
 * Hangi oyuncunun "kilit oyuncu" oldugunu otomatik tespit etmek zor,
 * bu yuzden basit bir kural kullaniyoruz: her eksik oyuncu icin kucuk
 * bir ceza, toplamda %10'u gecmeyecek sekilde sinirlandirilmis.
 */
function calculateInjuryImpact(injuryCount) {
  const penalty = Math.min(injuryCount * 0.02, 0.10);
  return {
    attackMultiplier: +(1 - penalty).toFixed(3),
    defenseWeaknessMultiplier: +(1 + penalty / 2).toFixed(3),
  };
}

/**
 * Son mactan bu yana gecen gun sayisi (yorgunluk/fikstur sikisikligi icin).
 * @param {Array} fixtures - takimin gecmis maclari
 * @param {number|string} teamId
 * @param {Date} referenceDate - hangi tarihe gore hesaplanacak (varsayilan: simdi)
 */
function calculateRestDays(fixtures, teamId, referenceDate = new Date()) {
  const played = fixtures
    .filter(f => f.goals.home !== null && new Date(f.fixture.date) < referenceDate)
    .sort((a, b) => new Date(b.fixture.date) - new Date(a.fixture.date));

  if (played.length === 0) return null;

  const lastMatchDate = new Date(played[0].fixture.date);
  const diffMs = referenceDate - lastMatchDate;
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Dinlenme gunune gore yorgunluk carpani. Cok yakin araliklarla oynayan
 * (orn. Avrupa kupasi sonrasi 2-3 gunde lig maci) takimlar hafif ceza alir,
 * uzun dinlenmis takimlar hafif bonus alir.
 */
function calculateFatigueMultiplier(restDays) {
  if (restDays === null || restDays === undefined) return 1.0;
  if (restDays <= 2) return 0.93;
  if (restDays <= 3) return 0.97;
  if (restDays >= 7) return 1.03;
  return 1.0;
}

/**
 * Son maclardaki galibiyet/maglubiyet serisini bulur (genel form, ev/deplasman
 * ayrimi yapmadan - momentum kavrami venue'dan bagimsizdir).
 */
function calculateStreak(fixtures, teamId) {
  const sorted = [...fixtures]
    .filter(f => f.goals.home !== null)
    .sort((a, b) => new Date(b.fixture.date) - new Date(a.fixture.date));

  if (sorted.length === 0) return { type: 'none', length: 0 };

  const results = sorted.map(f => {
    const isHome = String(f.teams.home.id) === String(teamId);
    const gf = isHome ? f.goals.home : f.goals.away;
    const ga = isHome ? f.goals.away : f.goals.home;
    if (gf > ga) return 'win';
    if (gf < ga) return 'loss';
    return 'draw';
  });

  const first = results[0];
  if (first === 'draw') return { type: 'none', length: 0 };

  let length = 0;
  for (const r of results) {
    if (r === first) length++;
    else break;
  }

  return { type: first, length };
}

/** Seriyi kucuk bir hucum carpanina cevirir - asiri etkiyi onlemek icin tavanli */
function streakMultiplier(streak) {
  if (streak.type === 'win') return 1 + Math.min(streak.length * 0.02, 0.08);
  if (streak.type === 'loss') return 1 - Math.min(streak.length * 0.02, 0.08);
  return 1.0;
}

/**
 * Iki takimin H2H (birbirlerine karsi) maclarini, HER IKI takimin de
 * zaten cekilmis olan "son N mac" fikstür listesinden cikarir - ayri bir
 * API cagrisi GEREKTIRMEZ. API-Football'un h2h endpoint'i kota/askida
 * oldugu icin hep bos donuyordu; bu fonksiyon TheSportsDB/TFF'den zaten
 * cekilen form verisini tarayip rakip takimin gectigi maclari (varsa)
 * bulur. Iki takim ayni ligdeyse son N mac penceresi genelde en az bir
 * H2H eslesmesi yakalar.
 * @param {Array} homeFixtures - ev sahibi takimin son maclari (API-Football sekli)
 * @param {Array} awayFixtures - deplasman takimin son maclari (API-Football sekli)
 * @param {number|string} homeTeamId
 * @param {number|string} awayTeamId
 */
function deriveH2HFromFixtures(homeFixtures, awayFixtures, homeTeamId, awayTeamId) {
  const matchesById = new Map();

  function collect(fixtures, opponentId) {
    if (!opponentId) return;
    fixtures.forEach(f => {
      const isVsOpponent = String(f.teams.home.id) === String(opponentId) || String(f.teams.away.id) === String(opponentId);
      if (isVsOpponent) {
        matchesById.set(String(f.fixture.id), f);
      }
    });
  }

  collect(homeFixtures, awayTeamId);
  collect(awayFixtures, homeTeamId);

  return Array.from(matchesById.values()).sort((a, b) => new Date(b.fixture.date) - new Date(a.fixture.date));
}

/**
 * Bir takimin KENDI ev/deplasman performans farkindan, lig ortalamasi
 * ile harmanlanmis, takime ozel ev sahibi avantaji carpani uretir.
 * Kucuk orneklem riskine karsi %50 takim / %50 lig ortalamasi agirlikli.
 * @param {object} fullSplit - splitHomeAwayForm(...) ciktisindaki {home, away}
 * @param {number} leagueAdvantageRatio - lig capinda tipik ev/deplasman gol orani
 */
function calculateTeamHomeAdvantageMultiplier(fullSplit, leagueAdvantageRatio = 1.26) {
  const homeAvg = fullSplit.home?.avgGoalsFor;
  const awayAvg = fullSplit.away?.avgGoalsFor;

  if (!homeAvg || !awayAvg || awayAvg === 0) return 1.0; // yeterli veri yok, notr

  const teamRatio = homeAvg / awayAvg;
  const blended = (teamRatio * 0.5) + (leagueAdvantageRatio * 0.5);
  const capped = Math.max(0.85, Math.min(1.35, blended));

  return +(capped / leagueAdvantageRatio).toFixed(3);
}

module.exports = {
  summarizeMatches,
  calculateHalfHistory,
  calculateWeightedGoalAverages,
  splitHomeAwayForm,
  calculateFirstHalfTendency,
  calculateH2HFirstHalfTendency,
  deriveH2HFromFixtures,
  combineFirstHalfProximity,
  calculateInjuryImpact,
  calculateRestDays,
  calculateFatigueMultiplier,
  calculateStreak,
  streakMultiplier,
  calculateTeamHomeAdvantageMultiplier,
};
