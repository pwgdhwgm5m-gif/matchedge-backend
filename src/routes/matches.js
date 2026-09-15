const express = require('express');
const router = express.Router();
const cache = require('../utils/cache');
const config = require('../config/config');
const freeFootballApi = require('../services/freeFootballApiService');

/** GET /api/matches?date=2026-09-09 */
router.get('/', async (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];

  const result = await cache.getOrFetch(
    `fixtures:${date}`,
    config.cache.ttlStatic,
    () => freeFootballApi.getMatchesByDate(date)
  );

  if (!result.ok) {
    return res.status(502).json({ error: 'Fikstur verisi alinamadi' });
  }

  const rawMatches = result.data?.response?.matches || [];
  const simplified = rawMatches.map(freeFootballApi.transformMatch);

  res.json({ date, matches: simplified, fromCache: result.fromCache });
});

module.exports = router;
