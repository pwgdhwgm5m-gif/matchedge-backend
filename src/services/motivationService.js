/**
 * API-Football'un standings yanitindaki "description" alani, o takimin
 * o anki durumunu zaten ozetliyor (orn. "Relegation", "Champions League",
 * "Promotion - Play-offs"). Bunu dogrudan kullanip bir motivasyon
 * carpani ve okunabilir bir etiket uretiyoruz.
 *
 * Carpanlar kaba bir sezgiseldir: baski altindaki takimlarin (kume
 * hatti veya unvan yarisi) ortalamadan biraz daha yuksek performans
 * gosterme egilimini modele yansitir. Zamanla gercek sonuclarla
 * kalibre edilmesi onerilir.
 */
function calculateMotivationFromDescription(description) {
  if (!description) {
    return { label: 'Orta SÄ±ra - NÃ¶tr', multiplier: 1.0 };
  }

  const desc = description.toLowerCase();

  if (desc.includes('relegation')) {
    return { label: 'KÃ¼me DÃ¼ÅŸme HattÄ±', multiplier: 1.12 };
  }
  if (desc.includes('champions league')) {
    return { label: 'Åžampiyonlar Ligi YarÄ±ÅŸÄ±', multiplier: 1.08 };
  }
  if (desc.includes('europa') || desc.includes('conference')) {
    return { label: 'Avrupa KupasÄ± YarÄ±ÅŸÄ±', multiplier: 1.05 };
  }
  if (desc.includes('promotion')) {
    return { label: 'Play-off / YÃ¼kselme YarÄ±ÅŸÄ±', multiplier: 1.1 };
  }

  return { label: 'Orta SÄ±ra - NÃ¶tr', multiplier: 1.0 };
}

/**
 * Standings API yanitindan belirli bir takimin satirini bulur.
 * @param {object} standingsResponse - API-Football /standings ham yaniti
 * @param {number|string} teamId
 */
function findTeamStanding(standingsResponse, teamId) {
  try {
    const table = standingsResponse?.response?.[0]?.league?.standings?.[0] || [];
    return table.find(row => String(row.team.id) === String(teamId)) || null;
  } catch {
    return null;
  }
}

module.exports = { calculateMotivationFromDescription, findTeamStanding };
