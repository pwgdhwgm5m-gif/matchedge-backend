const express = require('express');
const router = express.Router();
const Favorite = require('../models/Favorite');
const { requireAuth } = require('../middleware/authMiddleware');

router.use(requireAuth);

/** GET /api/favorites - kullanicinin favori maclarinin fixtureId listesi */
router.get('/', async (req, res) => {
  try {
    const favorites = await Favorite.find({ userId: req.user.userId });
    res.json({ favorites });
  } catch (err) {
    console.error('[favorites/list] Hata:', err.message);
    res.status(500).json({ error: 'Favoriler alinamadi.' });
  }
});

/** POST /api/favorites - favoriye ekle */
router.post('/', async (req, res) => {
  const { fixtureId, homeTeam, awayTeam } = req.body;
  if (!fixtureId) return res.status(400).json({ error: 'fixtureId zorunlu.' });

  try {
    const favorite = await Favorite.findOneAndUpdate(
      { userId: req.user.userId, fixtureId },
      { userId: req.user.userId, fixtureId, homeTeam, awayTeam },
      { upsert: true, new: true }
    );
    res.status(201).json({ favorite });
  } catch (err) {
    console.error('[favorites/create] Hata:', err.message);
    res.status(500).json({ error: 'Favoriye eklenemedi.' });
  }
});

/** DELETE /api/favorites/:fixtureId - favoriden cikar */
router.delete('/:fixtureId', async (req, res) => {
  try {
    await Favorite.deleteOne({ userId: req.user.userId, fixtureId: req.params.fixtureId });
    res.json({ deleted: true });
  } catch (err) {
    console.error('[favorites/delete] Hata:', err.message);
    res.status(500).json({ error: 'Favoriden cikarilamadi.' });
  }
});

module.exports = router;
