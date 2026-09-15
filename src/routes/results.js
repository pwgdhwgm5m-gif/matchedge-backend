const express = require('express');
const router = express.Router();
const cache = require('../utils/cache');
const config = require('../config/config');
const freeFootballApi = require('../services/freeFootballApiService');

/**
 * GET /api/results?date=2026-09-09
 * Belirli bir gunun tum mac sonuclarini, sadelestirilmis formatta dondurur.
 * Canli maclar da bu listede "isLive: true" olarak gorunur.
 */
router.get('/', async (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];

  const result = await cache.getOrFetch(
    `results:${date}`,
    config.cache.ttlLive,
    () => freeFootballApi.getMatchesByDate(date)
  );

  if (!result.ok) {
    return res.status(502).json({ error: 'Sonuc verisi alinamadi' });
  }

  const rawMatches = result.data?.response?.matches || [];
  const simplified = rawMatches.map(freeFootballApi.transformMatch);

  res.json({ date, matches: simplified, fromCache: result.fromCache });
});

module.exports = router;
