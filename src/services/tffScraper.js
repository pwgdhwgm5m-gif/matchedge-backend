/**
 * tffScraper.js
 * MatchEdge — Trendyol Süper Lig veri kaynağı (TFF.org scraping)
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
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept-Language': 'tr-TR,tr;q=0.9',
    },
  }, 10000);

  if (!res.ok) {
    throw new Error(`TFF fetch failed: HTTP ${res.status}`);
  }

  const buffer = await res.arrayBuffer();
  let html;
  try {
    html = new TextDecoder('windows-1254').decode(buffer);
  } catch (e) {
    html = Buffer.from(buffer).toString('utf-8');
  }
  return html;
}

function parseStandings(html) {
  const $ = cheerio.load(html);
  const standings = [];

  $('table').each((_, table) => {
    const headerText = $(table).find('tr').first().text();
    if (!/AV/.test(headerText) || !/\bP\b/.test(headerText)) return;

    $(table)
      .find('tr')
      .slice(1)
      .each((__, row) => {
        const cells = $(row).find('td');
        if (cells.length < 8) return;

        const nameCell = $(cells[0]).text().trim();
        const match = nameCell.match(/^(\d+)\.\s*(.+)$/);
        const rank = match ? parseInt(match[1], 10) : null;
        const name = match ? match[2].trim() : nameCell;

        const link
