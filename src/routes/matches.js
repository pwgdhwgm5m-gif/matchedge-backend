const express = require('express');
const router = express.Router();
const cache = require('../utils/cache');
const config = require('../config/config');
const sportsDb = require('../services/sportsDbService');

/** GET /api/matches?date=2026-09-16 */
router.get('/', async (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];

  const result = await cache.getOrFetch(
    `fixtures:${date}`,
    config.cache.ttlStatic,
    () => sportsDb.getMatchesByDate(date)
  );

  if (!result.ok) {
    return res.status(502).json({ error: 'Fikstur verisi alinamadi' });
  }

  const rawEvents = result.data?.events || [];
  const simplified = rawEvents.map(sportsDb.transformEvent);

  res.json({ date, matches: simplified, fromCache: result.fromCache });
});

module.exports = router;
