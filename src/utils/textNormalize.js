/**
 * textNormalize.js
 * Takım isimlerini dil bağımsız karşılaştırmak için normalize eder.
 * Türkçe (İ/ı), İskandinav dilleri (ø/å), Almanca (ü/ß) gibi özel
 * karakterlerin toLowerCase() ile hatalı eşleşmesini önler.
 */

function normalizeTeamName(str) {
  const normalized = String(str || '')
    .replace(/İ/g, 'I')
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/Ø/g, 'O')
    .replace(/ø/g, 'o')
    .replace(/Đ/g, 'D')
    .replace(/đ/g, 'd')
    .replace(/ß/g, 'ss')
    .toLowerCase()
    .trim();
  // National teams may use either official short or long English names.
  // Keep this alias exact so a club with a similar substring is not matched.
  return normalized === 'czechia' ? 'czech republic' : normalized;
}

/** Iki takim adinin normalize edilince ayni olup olmadigini kontrol eder */
function teamNamesMatch(nameA, nameB) {
  if (!nameA || !nameB) return false;
  return normalizeTeamName(nameA) === normalizeTeamName(nameB);
}

module.exports = { normalizeTeamName, teamNamesMatch };
