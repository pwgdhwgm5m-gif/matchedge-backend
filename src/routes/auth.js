const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const User = require('../models/User');
const {
  hashPassword, comparePassword, generateToken,
  generateRawToken, hashToken,
} = require('../services/authService');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../services/emailService');
const { requireAuth } = require('../middleware/authMiddleware');
const config = require('../config/config');
const { recordLoginEvent } = require('../services/loginAuditService');

const VERIFICATION_VALID_MINUTES = 15;
const RESEND_COOLDOWN_MS = 60 * 1000;

function createVerificationCode() {
  return String(crypto.randomInt(100000, 1000000));
}
const RESET_VALID_MINUTES = 60;

/**
 * POST /api/auth/register
 * body: { username, email, password }
 */
router.post('/register', async (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Kullanici adi, e-posta ve sifre zorunlu.' });
  }
  if (username.length < 3) {
    return res.status(400).json({ error: 'Kullanici adi en az 3 karakter olmali.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Sifre en az 6 karakter olmali.' });
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ error: 'Gecerli bir e-posta adresi gir.' });
  }
  if (username.toLowerCase() === config.adminUsername) {
    return res.status(409).json({ error: 'Bu kullanici adi kullanilamiyor.' });
  }

  try {
    const existing = await User.findOne({
      $or: [{ username: username.toLowerCase() }, { email: email.toLowerCase() }],
    });
    if (existing) {
      return res.status(409).json({ error: 'Bu kullanici adi veya e-posta zaten kayitli.' });
    }

    const passwordHash = await hashPassword(password);

    const rawVerificationToken = generateRawToken();
    const verificationCode = createVerificationCode();
    const verificationExpires = new Date(Date.now() + VERIFICATION_VALID_MINUTES * 60 * 1000);

    const user = await User.create({
      username, email, passwordHash,
      verificationTokenHash: hashToken(rawVerificationToken),
      verificationCodeHash: hashToken(verificationCode),
      verificationCodeAttempts: 0,
      verificationLastSentAt: new Date(),
      verificationExpires,
    });

    const emailResult = await sendVerificationEmail(user.email, {
      token: rawVerificationToken,
      code: verificationCode,
    });

    const token = generateToken(user);
    res.status(201).json({
      token,
      username: user.username,
      email: user.email,
      emailVerified: false,
      verificationEmailSent: Boolean(emailResult.sent),
    });
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
  const { username, password, timezone } = req.body;

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
    if (user.username === config.adminUsername) user.role = 'admin';
    user.lastLoginAt = now;
    user.lastActiveAt = now;
    user.loginCount = (user.loginCount || 0) + 1;
    await user.save();

    const token = generateToken(user);
    res.json({ token, username: user.username, emailVerified: user.emailVerified, isAdmin: user.role === 'admin' });
    recordLoginEvent({ user, req, clientTimezone: timezone }).catch(error => {
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
  res.json({ username: user.username, email: user.email, emailVerified: user.emailVerified, isAdmin: user.role === 'admin' });
});

/**
 * POST /api/auth/verify-email
 * body: { token }
 */
router.post('/verify-email', async (req, res) => {
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
    user.verificationCodeHash = null;
    user.verificationCodeAttempts = 0;
    user.verificationExpires = null;
    await user.save();

    res.json({ message: 'E-posta dogrulandi.' });
  } catch (err) {
    console.error('[auth/verify-email] Hata:', err.message);
    res.status(500).json({ error: 'Dogrulama basarisiz oldu.' });
  }
});

/**
 * POST /api/auth/verify-code
 * body: { email, code }
 */
router.post('/verify-code', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const code = String(req.body.code || '').replace(/\D/g, '');
  if (!email || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: 'E-posta ve 6 haneli doğrulama kodu gerekli.' });
  }

  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: 'Kod geçersiz veya süresi dolmuş.' });
    if (user.emailVerified) return res.json({ message: 'E-posta zaten doğrulanmış.', verified: true });
    if (!user.verificationExpires || user.verificationExpires <= new Date() || !user.verificationCodeHash) {
      return res.status(400).json({ error: 'Kodun süresi dolmuş. Yeni kod iste.' });
    }
    if ((user.verificationCodeAttempts || 0) >= 5) {
      return res.status(429).json({ error: 'Çok fazla hatalı deneme. Yeni kod iste.' });
    }

    if (hashToken(code) !== user.verificationCodeHash) {
      user.verificationCodeAttempts = (user.verificationCodeAttempts || 0) + 1;
      await user.save();
      return res.status(400).json({ error: 'Doğrulama kodu hatalı.' });
    }

    user.emailVerified = true;
    user.verificationTokenHash = null;
    user.verificationCodeHash = null;
    user.verificationCodeAttempts = 0;
    user.verificationExpires = null;
    await user.save();
    res.json({ message: 'E-posta doğrulandı.', verified: true });
  } catch (err) {
    console.error('[auth/verify-code] Hata:', err.message);
    res.status(500).json({ error: 'Doğrulama tamamlanamadı.' });
  }
});

/**
 * POST /api/auth/resend-verification
 * body: { email }
 */
router.post('/resend-verification', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'E-posta zorunlu.' });

  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    // Guvenlik: e-posta kayitli olmasa da ayni mesaji donuyoruz,
    // boylece kayitli e-postalari disaridan tahmin etmek zorlasir.
    let sent = false;
    if (user && !user.emailVerified) {
      if (user.verificationLastSentAt && Date.now() - user.verificationLastSentAt.getTime() < RESEND_COOLDOWN_MS) {
        return res.status(429).json({ error: 'Yeni kod istemeden önce 60 saniye bekle.' });
      }
      const rawToken = generateRawToken();
      const verificationCode = createVerificationCode();
      user.verificationTokenHash = hashToken(rawToken);
      user.verificationCodeHash = hashToken(verificationCode);
      user.verificationCodeAttempts = 0;
      user.verificationLastSentAt = new Date();
      user.verificationExpires = new Date(Date.now() + VERIFICATION_VALID_MINUTES * 60 * 1000);
      await user.save();
      const result = await sendVerificationEmail(user.email, { token: rawToken, code: verificationCode });
      sent = Boolean(result.sent);
    }
    res.json({ message: 'Eğer bu e-posta kayıtlıysa yeni doğrulama kodu gönderildi.', sent });
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
