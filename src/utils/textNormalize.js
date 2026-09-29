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

/** Provider-safe club-name comparison. Provider-native IDs remain authoritative;
 * this alias layer is only used to resolve that provider's fixture/team IDs. */
function teamNameCore(str) {
  const tokens=normalizeTeamName(str).replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/).filter(Boolean);
  const noise=new Set(['fc','afc','cf','sc','sv','fk','fk','ac','calcio','football','club']);
  while(tokens.length>1 && noise.has(tokens[0])) tokens.shift();
  while(tokens.length>1 && noise.has(tokens[tokens.length-1])) tokens.pop();
  return tokens.join(' ');
}
function teamNamesMatch(nameA, nameB) {
  if (!nameA || !nameB) return false;
  const a=normalizeTeamName(nameA).replace(/[^a-z0-9]+/g,' ').trim();
  const b=normalizeTeamName(nameB).replace(/[^a-z0-9]+/g,' ').trim();
  if(a===b)return true;
  const ca=teamNameCore(a),cb=teamNameCore(b);
  return ca.length>=4 && cb.length>=4 && ca===cb;
}

module.exports = { normalizeTeamName, teamNameCore, teamNamesMatch };
