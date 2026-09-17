const express = require('express');
const mongoose = require('mongoose');
const ChatMessage = require('../models/ChatMessage');
const SupportTicket = require('../models/SupportTicket');
const User = require('../models/User');
const { requireAuth } = require('../middleware/authMiddleware');
const { moderateMessage } = require('../services/chatModerationService');

const router = express.Router();
const rateWindows = new Map();
const MAX_MESSAGES_PER_MINUTE = 5;

router.use(requireAuth);

function validId(value) {
  return mongoose.Types.ObjectId.isValid(value);
}

async function currentUser(req) {
  return User.findById(req.user.userId);
}

function rateAllowed(userId) {
  const now = Date.now();
  const recent = (rateWindows.get(userId) || []).filter(time => now - time < 60000);
  if (recent.length >= MAX_MESSAGES_PER_MINUTE) return false;
  recent.push(now);
  rateWindows.set(userId, recent);
  return true;
}

async function requireAdmin(req, res, next) {
  const user = await currentUser(req);
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Yetkisiz.' });
  req.dbUser = user;
  next();
}

router.get('/moderation/reports', requireAdmin, async (req, res) => {
  const messages = await ChatMessage.find({
    $or: [{ status: 'under_review' }, { 'reportedBy.0': { $exists: true } }],
  }).sort({ updatedAt: -1 }).limit(200).lean();
  res.json({ messages });
});

router.patch('/moderation/:messageId', requireAdmin, async (req, res) => {
  if (!validId(req.params.messageId)) return res.status(400).json({ error: 'Geçersiz mesaj.' });
  const status = req.body.status;
  if (!['visible', 'removed'].includes(status)) return res.status(400).json({ error: 'Geçersiz durum.' });
  const message = await ChatMessage.findByIdAndUpdate(req.params.messageId, { status }, { new: true });
  if (!message) return res.status(404).json({ error: 'Mesaj bulunamadı.' });
  res.json({ message });
});

router.post('/support', async (req, res) => {
  const moderation = moderateMessage(req.body.message);
  if (!moderation.ok && moderation.code !== 'CONTACT') {
    return res.status(400).json({ error: moderation.message });
  }
  const message = String(req.body.message || '').trim();
  if (!message || message.length > 1000) return res.status(400).json({ error: 'Destek mesajı 1-1000 karakter olmalı.' });
  const ticket = await SupportTicket.create({
    user: req.user.userId,
    category: req.body.category || 'chat_safety',
    message,
  });
  res.status(201).json({ ticketId: ticket._id, message: 'Destek talebin alındı.' });
});

router.get('/:fixtureId', async (req, res) => {
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: 'Kullanıcı bulunamadı.' });
  const blocked = (user.blockedChatUsers || []).map(String);
  const query = {
    fixtureId: String(req.params.fixtureId),
    status: 'visible',
    author: { $nin: blocked },
  };
  const messages = await ChatMessage.find(query).sort({ createdAt: -1 }).limit(100).lean();
  res.json({
    messages: messages.reverse().map(item => ({
      id: item._id,
      authorId: item.author,
      authorName: item.authorName,
      text: item.text,
      createdAt: item.createdAt,
      mine: String(item.author) === String(req.user.userId),
    })),
    rulesAccepted: Boolean(user.chatRulesAcceptedAt),
    suspendedUntil: user.chatSuspendedUntil || null,
  });
});

router.post('/:fixtureId', async (req, res) => {
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: 'Kullanıcı bulunamadı.' });
  if (!user.emailVerified) return res.status(403).json({ error: 'Mesaj yazmak için e-posta doğrulaması gerekli.' });
  if (user.chatSuspendedUntil && user.chatSuspendedUntil > new Date()) {
    return res.status(403).json({ error: 'Sohbet erişimin geçici olarak durduruldu.' });
  }
  if (!user.chatRulesAcceptedAt) {
    if (req.body.acceptedRules !== true) return res.status(403).json({ error: 'Önce topluluk kurallarını kabul etmelisin.', code: 'RULES_REQUIRED' });
    user.chatRulesAcceptedAt = new Date();
    await user.save();
  }
  if (!rateAllowed(String(user._id))) return res.status(429).json({ error: 'Çok hızlı mesaj gönderiyorsun. Biraz bekle.' });

  const moderation = moderateMessage(req.body.text);
  if (!moderation.ok) return res.status(400).json({ error: moderation.message, code: moderation.code });

  const matchLabel = String(req.body.matchLabel || '').trim().slice(0, 140);
  if (!matchLabel) return res.status(400).json({ error: 'Maç bilgisi eksik.' });

  const message = await ChatMessage.create({
    fixtureId: String(req.params.fixtureId),
    matchLabel,
    author: user._id,
    authorName: user.username,
    text: moderation.text,
  });
  res.status(201).json({
    message: {
      id: message._id,
      authorId: user._id,
      authorName: user.username,
      text: message.text,
      createdAt: message.createdAt,
      mine: true,
    },
  });
});

router.delete('/message/:messageId', async (req, res) => {
  if (!validId(req.params.messageId)) return res.status(400).json({ error: 'Geçersiz mesaj.' });
  const message = await ChatMessage.findOneAndUpdate(
    { _id: req.params.messageId, author: req.user.userId },
    { status: 'removed' },
    { new: true }
  );
  if (!message) return res.status(404).json({ error: 'Mesaj bulunamadı.' });
  res.json({ ok: true });
});

router.post('/message/:messageId/report', async (req, res) => {
  if (!validId(req.params.messageId)) return res.status(400).json({ error: 'Geçersiz mesaj.' });
  const reason = ['abuse', 'spam', 'hate', 'sexual', 'personal_info', 'other'].includes(req.body.reason)
    ? req.body.reason : 'other';
  const message = await ChatMessage.findById(req.params.messageId);
  if (!message) return res.status(404).json({ error: 'Mesaj bulunamadı.' });
  if (String(message.author) === String(req.user.userId)) return res.status(400).json({ error: 'Kendi mesajını şikâyet edemezsin.' });

  const alreadyReported = message.reportedBy.some(id => String(id) === String(req.user.userId));
  if (!alreadyReported) {
    message.reportedBy.push(req.user.userId);
    message.reportReasons.push({ reporter: req.user.userId, reason });
    if (message.reportedBy.length >= 3) message.status = 'under_review';
    await message.save();
  }
  res.json({ ok: true, hidden: message.status !== 'visible' });
});

router.post('/block/:userId', async (req, res) => {
  if (!validId(req.params.userId) || String(req.params.userId) === String(req.user.userId)) {
    return res.status(400).json({ error: 'Geçersiz kullanıcı.' });
  }
  await User.findByIdAndUpdate(req.user.userId, { $addToSet: { blockedChatUsers: req.params.userId } });
  res.json({ ok: true });
});

router.delete('/block/:userId', async (req, res) => {
  if (!validId(req.params.userId)) return res.status(400).json({ error: 'Geçersiz kullanıcı.' });
  await User.findByIdAndUpdate(req.user.userId, { $pull: { blockedChatUsers: req.params.userId } });
  res.json({ ok: true });
});

module.exports = router;
