const express = require('express');
const router = express.Router();
const User = require('../models/User');
const {
  hashPassword, comparePassword, generateToken,
  generateRawToken, hashToken,
} = require('../services/authService');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../services/emailService');
const { requireAuth } = require('../middleware/authMiddleware');
const config = require('../config/config');
const { recordLoginEvent, setLocationConsent } = require('../services/loginAuditService');

const VERIFICATION_VALID_HOURS = 24;
const RESET_VALID_MINUTES = 60;

/**
 * POST /api/auth/register
 * body: { username, email, password, birthYear }
 */
router.post('/register', async (req, res) => {
  const { username, email, password, birthYear } = req.body;

  if (!username || !email || !password || !birthYear) {
    return res.status(400).json({ error: 'Kullanici adi, e-posta, sifre ve dogum yili zorunlu.' });
  }
  const year = Number(birthYear);
  const currentYear = new Date().getUTCFullYear();
  if (!Number.isInteger(year) || year < 1900 || year > currentYear) {
    return res.status(400).json({ error: 'Gecerli bir dogum yili gir.' });
  }
  if (currentYear - year < 18) {
    return res.status(403).json({ error: 'SoccerEdge Pro yalnizca 18 yas ve uzeri kullanicilar icindir.' });
  }
  // Only the year is collected; store Jan 1 for compatibility with the existing schema.
  const birthDate = new Date(Date.UTC(year, 0, 1));
  if (username.length < 3) {
    return res.status(400).json({ error: 'Kullanici adi en az 3 karakter olmali.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Sifre en az 6 karakter olmali.' });
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ error: 'Gecerli bir e-posta adresi gir.' });
  }

  try {
    const existing = await User.findOne({
      $or: [{ username: username.toLowerCase() }, { email: email.toLowerCase() }],
    });
    const isReservedAdmin = username.toLowerCase() === config.adminUsername;
    if (existing) {
      // Recovery path for the explicitly reserved admin username. This lets the
      // owner reclaim the reserved account without email delivery. It never
      // grants admin to arbitrary usernames.
      if (isReservedAdmin && existing.username.toLowerCase() === config.adminUsername) {
        existing.passwordHash = await hashPassword(password);
        existing.role = 'admin';
        existing.emailVerified = true;
        existing.dateOfBirth = birthDate;
        await existing.save();
        const token = generateToken(existing);
        return res.status(200).json({ token, username: existing.username, emailVerified: true, isAdmin: true, recovered: true });
      }
      return res.status(409).json({ error: 'Bu kullanici adi veya e-posta zaten kayitli.' });
    }

    const passwordHash = await hashPassword(password);

    // E-posta doğrulaması geçici olarak kapalıdır.
    // Yeniden etkinleştirildiğinde token üretimi ve gönderimi bu noktaya geri alınabilir.
    const user = await User.create({
      username, email, passwordHash,
      dateOfBirth: birthDate,
      role: isReservedAdmin ? 'admin' : 'user',
      emailVerified: true,
      verificationTokenHash: null,
      verificationExpires: null,
    });

    const token = generateToken(user);
    res.status(201).json({ token, username: user.username, emailVerified: true });
  } catch (err) {
    console.error('[auth/register] Hata:', err.message);
    res.status(500).json({ error: 'Kayit olusturulamadi. Veritabani baglantisini kontrol et.' });
  }
});

/**
 * POST /api/auth/login
 * body: { username, password }
 */


router.post('/login', async (req, res) => {
  const { username, password, timezone, geoConsent } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Kullanici adi ve sifre zorunlu.' });
  }

  try {
    const user = await User.findOne({ username: username.toLowerCase() });
    if (!user) {
      return res.status(401).json({ error: 'Kullanici adi veya sifre hatali.' });
    }

    const passwordMatches = await comparePassword(password, user.passwordHash);
    if (!passwordMatches) {
      return res.status(401).json({ error: 'Kullanici adi veya sifre hatali.' });
    }

    const now = new Date();
    // Administrative role is assigned only during protected provisioning.
    user.lastLoginAt = now;
    user.lastActiveAt = now;
    user.loginCount = (user.loginCount || 0) + 1;
    await user.save();

    const token = generateToken(user);
    res.json({ token, username: user.username, emailVerified: true, isAdmin: user.role === 'admin' });
    recordLoginEvent({ user, req, clientTimezone: timezone, geoConsent: geoConsent === true }).catch(error => {
      console.error('[auth/login-audit] Hata:', error.message);
    });
  } catch (err) {
    console.error('[auth/login] Hata:', err.message);
    res.status(500).json({ error: 'Giris yapilamadi. Veritabani baglantisini kontrol et.' });
  }
});

/**
 * GET /api/auth/me
 */
router.get('/me', requireAuth, async (req, res) => {
  const user = await User.findById(req.user.userId);
  if (!user) return res.status(404).json({ error: 'Kullanici bulunamadi.' });
  res.json({ username: user.username, email: user.email, emailVerified: true, isAdmin: user.role === 'admin' });
});

/**
 * POST /api/auth/location-consent
 * body: { consent: boolean, timezone?: string }
 */
router.post('/location-consent', requireAuth, async (req, res) => {
  const { consent, timezone } = req.body || {};
  if (typeof consent !== 'boolean') {
    return res.status(400).json({ error: 'Konum tercihi true veya false olmali.' });
  }

  try {
    const result = await setLocationConsent({
      userId: req.user.userId,
      req,
      clientTimezone: timezone,
      consent,
    });
    res.json(result);
  } catch (err) {
    console.error('[auth/location-consent] Hata:', err.message);
    res.status(500).json({ error: 'Konum tercihi kaydedilemedi.' });
  }
});

/**
 * POST /api/auth/verify-email
 * body: { token }
 */
router.post('/verify-email', async (req, res) => {
  return res.status(503).json({ error: 'Bu ozellik gecici olarak kullanima kapali.' });
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token eksik.' });

  try {
    const tokenHash = hashToken(token);
    const user = await User.findOne({
      verificationTokenHash: tokenHash,
      verificationExpires: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({ error: 'Dogrulama baglantisi gecersiz veya suresi dolmus.' });
    }

    user.emailVerified = true;
    user.verificationTokenHash = null;
    user.verificationExpires = null;
    await user.save();

    res.json({ message: 'E-posta dogrulandi.' });
  } catch (err) {
    console.error('[auth/verify-email] Hata:', err.message);
    res.status(500).json({ error: 'Dogrulama basarisiz oldu.' });
  }
});

/**
 * POST /api/auth/resend-verification
 * body: { email }
 */
router.post('/resend-verification', async (req, res) => {
  return res.status(503).json({ error: 'Bu ozellik gecici olarak kullanima kapali.' });
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'E-posta zorunlu.' });

  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    // Guvenlik: e-posta kayitli olmasa da ayni mesaji donuyoruz,
    // boylece kayitli e-postalari disaridan tahmin etmek zorlasir.
    if (user && !user.emailVerified) {
      const rawToken = generateRawToken();
      user.verificationTokenHash = hashToken(rawToken);
      user.verificationExpires = new Date(Date.now() + VERIFICATION_VALID_HOURS * 60 * 60 * 1000);
      await user.save();
      sendVerificationEmail(user.email, rawToken);
    }
    res.json({ message: 'Eger bu e-posta kayitliysa, bir dogrulama baglantisi gonderildi.' });
  } catch (err) {
    console.error('[auth/resend-verification] Hata:', err.message);
    res.status(500).json({ error: 'Istek islenemedi.' });
  }
});

/**
 * POST /api/auth/forgot-password
 * body: { email }
 */
router.post('/forgot-password', async (req, res) => {
  return res.status(503).json({ error: 'Bu ozellik gecici olarak kullanima kapali.' });
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'E-posta zorunlu.' });

  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (user) {
      const rawToken = generateRawToken();
      user.resetTokenHash = hashToken(rawToken);
      user.resetExpires = new Date(Date.now() + RESET_VALID_MINUTES * 60 * 1000);
      await user.save();
      sendPasswordResetEmail(user.email, rawToken);
    }
    // Guvenlik: e-posta kayitli olmasa da ayni mesaj donuyor
    res.json({ message: 'Eger bu e-posta kayitliysa, bir sifre sifirlama baglantisi gonderildi.' });
  } catch (err) {
    console.error('[auth/forgot-password] Hata:', err.message);
    res.status(500).json({ error: 'Istek islenemedi.' });
  }
});

/**
 * POST /api/auth/reset-password
 * body: { token, newPassword }
 */
router.post('/reset-password', async (req, res) => {
  return res.status(503).json({ error: 'Bu ozellik gecici olarak kullanima kapali.' });
  const { token, newPassword } = req.body;
  if (!token || !newPassword) {
    return res.status(400).json({ error: 'Token ve yeni sifre zorunlu.' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'Sifre en az 6 karakter olmali.' });
  }

  try {
    const tokenHash = hashToken(token);
    const user = await User.findOne({
      resetTokenHash: tokenHash,
      resetExpires: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({ error: 'Sifirlama baglantisi gecersiz veya suresi dolmus.' });
    }

    user.passwordHash = await hashPassword(newPassword);
    user.resetTokenHash = null;
    user.resetExpires = null;
    await user.save();

    res.json({ message: 'Sifre basariyla degistirildi.' });
  } catch (err) {
    console.error('[auth/reset-password] Hata:', err.message);
    res.status(500).json({ error: 'Sifre sifirlanamadi.' });
  }
});

module.exports = router;
