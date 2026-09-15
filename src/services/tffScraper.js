/**
 * tffScraper.js
 * MatchEdge — Trendyol Süper Lig veri kaynağı (TFF.org scraping)
 *
 * NOT: TFF.org resmi bir API sunmuyor, bu modül sayfanın HTML'ini
 * scrape eder. Sayfa ASP.NET WebForms ile render ediliyor, bu yüzden
 * seçiciler (selectors) TFF sitesindeki yapı değişirse kırılabilir.
 * Bu dosyayı entegre etmeden önce gerçek sayfa kaynağını (view-source)
 * inceleyip aşağıdaki seçicileri doğrula / gerekirse güncelle.
 *
 * Gereken paket: cheerio
 *   npm install cheerio
 *
 * Kullanım (MatchEdge backend içinde):
 *   const { getStandings, getFixtures, getTeamForm } = require('./tffScraper');
 *   const standings = await getStandings();
 *   const fixtures  = await getFixtures();
 *   const form      = await getTeamForm('GALATASARAY A.Ş.', 5);
 */

const cheerio = require('cheerio');

// Güncel sezona her zaman işaret eden sabit sayfa.
// (Geçmiş sezonlar için ayrı pageID'ler var, örn. 2024-25 -> pageID=1730)
const TFF_SUPERLIG_URL = 'https://www.tff.org/default.aspx?pageID=198';

/**
 * MatchEdge'in mevcut fetchT() timeout wrapper'ını kullan.
 * Eğer bu dosya ayrı bir modül olarak duruyorsa, fetchT'yi
 * projenin merkezi yerinden import et. Burada basit bir
 * fallback timeout fetch tanımlıyoruz; kendi fetchT() varsa
 * bunun yerine onu kullan.
 */
async function fetchT(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTffHtml() {
  const res = await fetchT(TFF_SUPERLIG_URL, {
    headers: {
      // TFF bazı basit bot isteklerini reddedebiliyor; normal bir
      // tarayıcı User-Agent'i göndermek genelde sorunu çözüyor.
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept-Language': 'tr-TR,tr;q=0.9',
    },
  }, 10000);

  if (!res.ok) {
    throw new Error(`TFF fetch failed: HTTP ${res.status}`);
  }

  // TFF sayfası windows-1254 (Türkçe) encoding kullanıyor.
  // Node'un fetch'i varsayılan olarak UTF-8 decode eder, bu yüzden
  // Türkçe karakterler bozuk gelebilir. Ham buffer üzerinden
  // doğru encoding ile decode etmek gerekebilir:
  const buffer = await res.arrayBuffer();
  let html;
  try {
    // Node 18+: TextDecoder ile windows-1254 decode (iconv-lite
    // kurulu değilse bu satır hata verebilir — gerekirse
    // `npm install iconv-lite` ekleyip onunla decode et).
    html = new TextDecoder('windows-1254').decode(buffer);
  } catch (e) {
    // Fallback: UTF-8 (Türkçe karakterler bozuk olabilir, ama
    // scraping mantığı büyük ölçüde ASCII sütun başlıklarına ve
    // href pattern'lerine dayandığı için çoğu şey yine çalışır)
    html = Buffer.from(buffer).toString('utf-8');
  }
  return html;
}

/**
 * Puan cetvelini parse eder.
 * TFF sayfasında tablo başlıkları: O G B M A Y AV P
 * (Oynanan, Galibiyet, Beraberlik, Mağlubiyet, Attığı, Yediği, Averaj, Puan)
 */
function parseStandings(html) {
  const $ = cheerio.load(html);
  const standings = [];

  // "AV" ve "P" başlıklarını içeren tabloyu bul (puan cetveli tablosu).
  $('table').each((_, table) => {
    const headerText = $(table).find('tr').first().text();
    if (!/AV/.test(headerText) || !/\bP\b/.test(headerText)) return;

    $(table)
      .find('tr')
      .slice(1) // başlık satırını atla
      .each((__, row) => {
        const cells = $(row).find('td');
        if (cells.length < 8) return;

        // İlk hücre: "1.GALATASARAY A.Ş." gibi sıra+isim birleşik olabilir
        const nameCell = $(cells[0]).text().trim();
        const match = nameCell.match(/^(\d+)\.\s*(.+)$/);
        const rank = match ? parseInt(match[1], 10) : null;
        const name = match ? match[2].trim() : nameCell;

        // kulupID'yi href'ten çek (form/fikstür eşleştirmesi için kritik)
        const link = $(cells[0]).find('a').attr('href') || '';
        const idMatch = link.match(/kulupID=(\d+)/i);
        const kulupID = idMatch ? idMatch[1] : null;

        const nums = [];
        for (let i = 1; i < cells.length; i++) {
          const val = $(cells[i]).text().trim();
          nums.push(val);
        }
        // Beklenen sıra: O, G, B, M, A, Y, AV, P
        const [played, wins, draws, losses, goalsFor, goalsAgainst, goalDiff, points] = nums;

        if (!name || played === undefined) return;

        standings.push({
          rank,
          kulupID,
          name,
          played: toInt(played),
          wins: toInt(wins),
          draws: toInt(draws),
          losses: toInt(losses),
          goalsFor: toInt(goalsFor),
          goalsAgainst: toInt(goalsAgainst),
          goalDiff: toInt(goalDiff),
          points: toInt(points),
        });
      });
  });

  return standings;
}

/**
 * Tam sezon fikstürünü (1-34. hafta) parse eder.
 * Oynanmış maçlar skor içerir ("2 - 2"), oynanmamışlar "-" içerir.
 */
function parseFixtures(html) {
  const $ = cheerio.load(html);
  const fixtures = [];

  // Maç detay linklerini (macId= içeren href) temel alarak satırları eşleştir.
  $('a[href*="macId="]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const macIdMatch = href.match(/macId=(\d+)/i);
    if (!macIdMatch) return;
    const macId = macIdMatch[1];

    const scoreText = $(el).text().trim();

    const row = $(el).closest('tr');
    if (!row.length) return;

    const teamLinks = row.find('a[href*="kulupId="], a[href*="kulupID="]');
    if (teamLinks.length < 2) return;

    const homeName = $(teamLinks[0]).text().trim();
    const awayName = $(teamLinks[1]).text().trim();
    const homeHref = $(teamLinks[0]).attr('href') || '';
    const awayHref = $(teamLinks[1]).attr('href') || '';
    const homeId = (homeHref.match(/kulupI[dD]=(\d+)/i) || [])[1] || null;
    const awayId = (awayHref.match(/kulupI[dD]=(\d+)/i) || [])[1] || null;

    let homeScore = null;
    let awayScore = null;
    const scoreMatch = scoreText.match(/^(\d+)\s*-\s*(\d+)$/);
    const finished = !!scoreMatch;
    if (scoreMatch) {
      homeScore = parseInt(scoreMatch[1], 10);
      awayScore = parseInt(scoreMatch[2], 10);
    }

    fixtures.push({
      macId,
      home: { id: homeId, name: homeName },
      away: { id: awayId, name: awayName },
      finished,
      homeScore,
      awayScore,
    });
  });

  return fixtures;
}

function toInt(v) {
  const n = parseInt(String(v).replace(/[^\-\d]/g, ''), 10);
  return Number.isNaN(n) ? null : n;
}

async function getStandings() {
  const html = await fetchTffHtml();
  return parseStandings(html);
}

async function getFixtures() {
  const html = await fetchTffHtml();
  return parseFixtures(html);
}

async function getTeamForm(teamIdentifier, lastN = 5) {
  const fixtures = await getFixtures();

  const isMatch = (team) => {
    if (!team) return false;
    if (team.id && String(team.id) === String(teamIdentifier)) return true;
    if (team.name && team.name.toLowerCase().includes(String(teamIdentifier).toLowerCase())) {
      return true;
    }
    return false;
  };

  const teamMatches = fixtures.filter(
    (f) => f.finished && (isMatch(f.home) || isMatch(f.away))
  );

  const lastMatches = teamMatches.slice(-lastN);

  const form = lastMatches.map((f) => {
    const isHome = isMatch(f.home);
    const teamScore = isHome ? f.homeScore : f.awayScore;
    const oppScore = isHome ? f.awayScore : f.homeScore;
    if (teamScore > oppScore) return 'W';
    if (teamScore < oppScore) return 'L';
    return 'D';
  });

  return {
    team: teamIdentifier,
    lastN,
    form: form.join(''),
    matches: lastMatches,
  };
}

module.exports = {
  getStandings,
  getFixtures,
  getTeamForm,
  TFF_SUPERLIG_URL,
};
