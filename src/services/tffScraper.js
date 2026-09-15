/**
 * tffScraper.js
 * MatchEdge — Trendyol Süper Lig veri kaynağı (TFF.org scraping)
 *
 * NOT: TFF.org resmi bir API sunmuyor, bu modül sayfanın HTML'ini
 * scrape eder. Sayfa ASP.NET WebForms ile render ediliyor, bu yüzden
 * seçiciler (selectors) TFF sitesindeki yapı değişirse kırılabilir.
 *
 * Gereken paket: cheerio
 *   npm install cheerio
 */

const cheerio = require('cheerio');

const TFF_SUPERLIG_URL = 'https://www.tff.org/default.aspx?pageID=198';

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
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64;
