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

        const link = $(cells[0]).find('a').attr('href') || '';
        const idMatch = link.match(/kulupID=(\d+)/i);
        const kulupID = idMatch ? idMatch[1] : null;

        const nums = [];
        for (let i = 1; i < cells.length; i++) {
          nums.push($(cells[i]).text().trim());
        }
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

const DATE_PATTERN = /(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/;

function parseTurkishDate(text) {
  const m = text.match(DATE_PATTERN);
  if (!m) return null;
  const [, day, month, year, hour, minute] = m;
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${hour ? String(hour).padStart(2, '0') : '00'}:${minute || '00'}:00`;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

function parseFixtures(html) {
  const $ = cheerio.load(html);
  const fixtures = [];

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

    let matchDate = parseTurkishDate(row.text());
    if (!matchDate) {
      const prevRow = row.prev('tr');
      if (prevRow.length) matchDate = parseTurkishDate(prevRow.text());
    }
    if (!matchDate) {
      const container = row.closest('table').prev();
      if (container.length) matchDate = parseTurkishDate(container.text());
    }

    fixtures.push({
      macId,
      home: { id: homeId, name: homeName },
      away: { id: awayId, name: awayName },
      finished,
      homeScore,
      awayScore,
      date: matchDate ? matchDate.toISOString() : null,
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

  const hasDates = teamMatches.length > 0 && teamMatches.every((f) => f.date);
  const sortedMatches = hasDates
    ? [...teamMatches].sort((a, b) => new Date(a.date) - new Date(b.date))
    : teamMatches;

  const lastMatches = sortedMatches.slice(-lastN);

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
    datesAvailable: hasDates,
  };
}

function adaptFixturesToApiFootballFormat(tffFixtures) {
  return tffFixtures
    .filter((f) => f.finished)
    .map((f) => ({
      fixture: { id: f.macId, date: f.date },
      teams: {
        home: { id: f.home.id, name: f.home.name },
        away: { id: f.away.id, name: f.away.name },
      },
      goals: { home: f.homeScore, away: f.awayScore },
      score: { halftime: { home: null, away: null } },
    }));
}

async function getFixturesAsApiFootballFormat() {
  const fixtures = await getFixtures();
  return adaptFixturesToApiFootballFormat(fixtures);
}

module.exports = {
  getStandings,
  getFixtures,
  getTeamForm,
  getFixturesAsApiFootballFormat,
  adaptFixturesToApiFootballFormat,
  TFF_SUPERLIG_URL,
};
