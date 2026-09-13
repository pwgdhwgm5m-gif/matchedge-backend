/**
 * Farkli veri saglayicilari (API-Football, The Odds API vb.) ayni takimi
 * farkli yazabiliyor: aksanli/aksansiz (Ã–rebro / Orebro), kisaltmali/
 * kisaltmasiz (IFK GÃ¶teborg / Goteborg), bÃ¼yÃ¼k/kÃ¼Ã§Ã¼k harf farki vb.
 * Bu Ã¶zellikle Isvec, Norvec, Finlandiya, Isvicre gibi Latin alfabesinin
 * genisletilmis harflerini (Ã¤, Ã¶, Ã¥, Ã¼, Ã¸, Ã¾, Ã°, ÃŸ) kullanan ulkelerde
 * sorun cikariyor - iki kaynak ayni takimi farkli yazinca exact-match
 * karsilastirma basarisiz oluyor ve veri eslesmiyor.
 *
 * Bu fonksiyon iki ismi de "ortak bir payda"ya indirger: aksanlari
 * sadelestirir, ozel harfleri (JS'in NFD normalizasyonunun cozemedigi
 * Ã¸, Ã¾, Ã°, ÃŸ gibi harfleri) manuel karsiliklarina cevirir, yaygin kulup
 * on/arka eklerini (FC, SK, IF, AIK vb.) atar ve kucuk harfe cevirir.
 */
function normalizeTeamName(name) {
  if (!name) return '';

  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // kompozit aksanlar: Ã¡->a, Ã¶->o, Ã¼->u, Ã©->e vb.
    .replace(/Ã¸/gi, 'o')             // Norvec/Danimarka - NFD ile cozulmuyor
    .replace(/Ã¦/gi, 'ae')            // Norvec/Danimarka/Izlanda
    .replace(/Ã¾/gi, 'th')            // Izlanda
    .replace(/Ã°/gi, 'd')             // Izlanda
    .replace(/ÃŸ/gi, 'ss')            // Almanca/Isvicre
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')    // kalan noktalama/ozel karakterleri bosluga cevir
    .replace(/\b(fc|sk|if|bk|aik|cf|sc|ac|fk|ff|club|the|calcio)\b/g, '') // yaygin kulup ekleri
    .replace(/\s+/g, ' ')
    .trim();
}

/** Iki takim adinin normalize edilince ayni olup olmadigini kontrol eder */
function teamNamesMatch(nameA, nameB) {
  if (!nameA || !nameB) return false;
  return normalizeTeamName(nameA) === normalizeTeamName(nameB);
}

module.exports = { normalizeTeamName, teamNamesMatch };
