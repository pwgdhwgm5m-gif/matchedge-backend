const express = require('express');
const router = express.Router();
const PushSubscription = require('../models/PushSubscription');
const { requireAuth } = require('../middleware/authMiddleware');

router.get('/public-key', (req, res) => res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || '' }));
router.use(requireAuth);

router.post('/subscribe', async (req, res) => {
  const s = req.body && req.body.subscription;
  if (!s || !s.endpoint || !s.keys || !s.keys.p256dh || !s.keys.auth) return res.status(400).json({ error: 'Invalid push subscription' });
  await PushSubscription.findOneAndUpdate(
    { endpoint: s.endpoint },
    { userId: req.user.userId, endpoint: s.endpoint, keys: s.keys, userAgent: String(req.headers['user-agent'] || '').slice(0, 300), lastSeenAt: new Date() },
    { upsert: true, new: true }
  );
  res.status(201).json({ subscribed: true });
});

router.post('/unsubscribe', async (req, res) => {
  const endpoint = req.body && req.body.endpoint;
  if (endpoint) await PushSubscription.deleteOne({ endpoint, userId: req.user.userId });
  res.json({ subscribed: false });
});

module.exports = router;
