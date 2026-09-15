/**
 * textNormalize.js
 * Takım isimlerini dil bağımsız karşılaştırmak için normalize eder.
 * Türkçe (İ/ı), İskandinav dilleri (ø/å), Almanca (ü/ß) gibi özel
 * karakterlerin toLowerCase() ile hatalı eşleşmesini önler.
 */

function normalizeTeamName(str) {
  return String(str || '')
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
}

module.exports = { normalizeTeamName };
