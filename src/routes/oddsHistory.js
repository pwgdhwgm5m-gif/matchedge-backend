const express = require('express');
const router = express.Router();
const oddsApi = require('../services/oddsApiService');

/**
 * GET /api/odds-history/:sportKey
 * Zaman icinde biriken oran anlik goruntulerini dondurur (grafik icin).
 * Sunucu yeni baslamissa veya henuz 30 dk gecmemisse bos/kisa donebilir.
 */
router.get('/:sportKey', (req, res) => {
  const history = oddsApi.getOddsHistory(req.params.sportKey);
  res.json({ sportKey: req.params.sportKey, snapshots: history });
});

module.exports = router;
