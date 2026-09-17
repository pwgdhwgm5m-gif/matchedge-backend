const blockedTerms = [
  'amk', 'aq', 'amina', 'orospu', 'pic', 'siktir', 'sikerim', 'sikik', 'gerizekali',
  'salak', 'aptal', 'ibne', 'gotveren', 'kahpe', 'yavşak', 'yavsak',
  'fuck', 'fucker', 'bitch', 'cunt', 'nigger', 'retard', 'whore'
];

const threatPatterns = [
  /\b(oldur|öldür|vururum|geber|keserim|bulacagim|bulacağım)\b/i,
  /\b(kill\s+you|i\s*will\s*kill|die\s+bitch)\b/i,
];

const contactPatterns = [
  /https?:\/\//i,
  /www\./i,
  /(?:t\.me|telegram|whatsapp|instagram|discord|snapchat)/i,
  /(?:\+?\d[\d\s().-]{7,}\d)/,
  /@[a-z0-9_.]{3,}/i,
];

function canonical(value = '') {
  return value
    .normalize('NFKD')
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[013457@$]/g, c => ({ '0':'o','1':'i','3':'e','4':'a','5':'s','7':'t','@':'a','$':'s' }[c]))
    .replace(/(.)\1{2,}/g, '$1$1');
}

function compact(value = '') {
  return canonical(value).replace(/[^a-z0-9]/g, '');
}

function moderateMessage(input) {
  const text = String(input || '').trim().replace(/\s+/g, ' ');
  if (!text) return { ok: false, code: 'EMPTY', message: 'Mesaj boş olamaz.' };
  if (text.length > 280) return { ok: false, code: 'TOO_LONG', message: 'Mesaj en fazla 280 karakter olabilir.' };

  const normalized = canonical(text);
  const joined = compact(text);
  const hasBlockedTerm = blockedTerms.some(term => {
    const clean = compact(term);
    return normalized.split(/[^a-z0-9]+/).includes(clean) || joined.includes(clean);
  });
  if (hasBlockedTerm || threatPatterns.some(pattern => pattern.test(normalized))) {
    return { ok: false, code: 'UNSAFE', message: 'Bu mesaj topluluk kurallarına uygun değil.' };
  }
  if (contactPatterns.some(pattern => pattern.test(text))) {
    return { ok: false, code: 'CONTACT', message: 'Bağlantı, kullanıcı adı veya iletişim bilgisi paylaşılamaz.' };
  }
  if (/(.)\1{9,}/i.test(text) || (text.match(/[!?]/g) || []).length > 8) {
    return { ok: false, code: 'SPAM', message: 'Mesaj spam olarak algılandı.' };
  }
  return { ok: true, text };
}

module.exports = { moderateMessage };
