/**
 * API-Football'un standings yanitindaki "description" alani, o takimin
 * o anki durumunu zaten ozetliyor (orn. "Relegation", "Champions League",
 * "Promotion - Play-offs"). TheSportsDB'nin lookuptable.php'si de ayni
 * sekilde "strDescription" alani doner - bu yuzden ayni fonksiyon her
 * iki kaynak icin de calisir. Bunu dogrudan kullanip bir motivasyon
 * carpani ve okunabilir bir etiket uretiyoruz.
 *
 * Carpanlar kaba bir sezgiseldir: baski altindaki takimlarin (kume
 * hatti veya unvan yarisi) ortalamadan biraz daha yuksek performans
 * gosterme egilimini modele yansitir. Zamanla gercek sonuclarla
 * kalibre edilmesi onerilir.
 */
function calculateMotivationFromDescription(description) {
  if (!description) {
    return { label: 'Orta Sıra - Nötr', multiplier: 1.0 };
  }

  const desc = description.toLowerCase();

  if (desc.includes('relegation')) {
    return { label: 'Küme Düşme Hattı', multiplier: 1.12 };
  }
  if (desc.includes('champions league')) {
    return { label: 'Şampiyonlar Ligi Yarışı', multiplier: 1.08 };
  }
  if (desc.includes('europa') || desc.includes('conference')) {
    return { label: 'Avrupa Kupası Yarışı', multiplier: 1.05 };
  }
  if (desc.includes('promotion')) {
    return { label: 'Play-off / Yükselme Yarışı', multiplier: 1.1 };
  }

  return { label: 'Orta Sıra - Nötr', multiplier: 1.0 };
}

/**
 * TFF (Süper Lig) puan durumunda API-Football/TheSportsDB'deki gibi hazir
 * bir "description" alani yok - sadece siralama var. Bu yuzden sadece
 * SIRALAMAYA bakarak kaba bir motivasyon tahmini uretiyoruz. Esikler
 * Türkiye Süper Lig'in tipik Avrupa kupasi/kume dusme dagilimina gore
 * (yaklasik): ilk 2 = sampiyonluk yarisi, ilk 4 = Sampiyonlar Ligi,
 * ilk 6 = Avrupa kupasi, son 3 = kume dusme hatti.
 */
function calculateMotivationFromRank(rank, totalTeams) {
  if (!rank || !totalTeams) {
    return { label: 'Orta Sıra - Nötr', multiplier: 1.0 };
  }

  if (rank <= 2) {
    return { label: 'Şampiyonluk Yarışı', multiplier: 1.1 };
  }
  if (rank <= 4) {
    return { label: 'Şampiyonlar Ligi Yarışı', multiplier: 1.08 };
  }
  if (rank <= 6) {
    return { label: 'Avrupa Kupası Yarışı', multiplier: 1.05 };
  }
  if (rank > totalTeams - 3) {
    return { label: 'Küme Düşme Hattı', multiplier: 1.12 };
  }

  return { label: 'Orta Sıra - Nötr', multiplier: 1.0 };
}

/**
 * NORMALLESTIRILMIS puan durumu tablosundan ({teamId, teamName, rank,
 * points, description}) belirli bir takimin satirini bulur. Hem
 * TheSportsDB hem TFF standings verisi bu ortak sekle cevriliyor,
 * bu yuzden tek bir fonksiyon her ikisi icin de calisir.
 * @param {Array} table - [{teamId, teamName, rank, points, description}, ...]
 * @param {number|string} teamId
 */
function findTeamStanding(table, teamId) {
  if (!table || !teamId) return null;
  return table.find(row => String(row.teamId) === String(teamId)) || null;
}

/**
 * ESKI: API-Football'un ham /standings yanitindan belirli bir takimin
 * satirini bulur. Sadece artik nadiren kullanilan (TheSportsDB'de
 * eslesmeyen ligler icin) API-Football fallback yolunda kullanilir.
 * @param {object} standingsResponse - API-Football /standings ham yaniti
 * @param {number|string} teamId
 */
function findTeamStandingLegacy(standingsResponse, teamId) {
  try {
    const table = standingsResponse?.response?.[0]?.league?.standings?.[0] || [];
    return table.find(row => String(row.team.id) === String(teamId)) || null;
  } catch {
    return null;
  }
}

module.exports = {
  calculateMotivationFromDescription,
  calculateMotivationFromRank,
  findTeamStanding,
  findTeamStandingLegacy,
};
