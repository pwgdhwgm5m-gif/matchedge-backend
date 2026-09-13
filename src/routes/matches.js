const express = require('express');
const router = express.Router();
const cache = require('../utils/cache');
const config = require('../config/config');
const footballApi = require('../services/footballApiService');

/** GET /api/matches?date=2026-09-09 */
router.get('/', async (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];

  const result = await cache.getOrFetch(
    `fixtures:${date}`,
    config.cache.ttlStatic,
    () => footballApi.getFixturesByDate(date)
  );

  if (!result.ok) {
    return res.status(502).json({ error: 'Fikstur verisi alinamadi' });
  }

  res.json({ date, matches: result.data?.response || [], fromCache: result.fromCache });
});

module.exports = router;
