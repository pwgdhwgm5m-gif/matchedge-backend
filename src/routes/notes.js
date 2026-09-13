const express = require('express');
const router = express.Router();
const Note = require('../models/Note');
const { requireAuth } = require('../middleware/authMiddleware');

router.use(requireAuth);

/** GET /api/notes - giris yapmis kullanicinin tum notlari */
router.get('/', async (req, res) => {
  try {
    const notes = await Note.find({ userId: req.user.userId }).sort({ createdAt: -1 });
    res.json({ notes });
  } catch (err) {
    console.error('[notes/list] Hata:', err.message);
    res.status(500).json({ error: 'Notlar alinamadi.' });
  }
});

/** POST /api/notes - yeni not olustur */
router.post('/', async (req, res) => {
  const { match, selection, comment, fixtureId, matchDate } = req.body;

  if (!match || !selection) {
    return res.status(400).json({ error: 'Mac ve secim alanlari zorunlu.' });
  }

  try {
    const note = await Note.create({
      userId: req.user.userId,
      match, selection, comment, fixtureId, matchDate,
    });
    res.status(201).json({ note });
  } catch (err) {
    console.error('[notes/create] Hata:', err.message);
    res.status(500).json({ error: 'Not olusturulamadi.' });
  }
});

/** PATCH /api/notes/:id - sonucu guncelle (elle veya otomatik kontrol) */
router.patch('/:id', async (req, res) => {
  const { result, autoChecked } = req.body;

  try {
    const note = await Note.findOne({ _id: req.params.id, userId: req.user.userId });
    if (!note) return res.status(404).json({ error: 'Not bulunamadi.' });

    if (result !== undefined) note.result = result;
    if (autoChecked !== undefined) note.autoChecked = autoChecked;
    await note.save();

    res.json({ note });
  } catch (err) {
    console.error('[notes/update] Hata:', err.message);
    res.status(500).json({ error: 'Not guncellenemedi.' });
  }
});

/** DELETE /api/notes/:id */
router.delete('/:id', async (req, res) => {
  try {
    const result = await Note.deleteOne({ _id: req.params.id, userId: req.user.userId });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Not bulunamadi.' });
    res.json({ deleted: true });
  } catch (err) {
    console.error('[notes/delete] Hata:', err.message);
    res.status(500).json({ error: 'Not silinemedi.' });
  }
});

module.exports = router;
