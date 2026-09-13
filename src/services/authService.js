const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('../config/config');

const SALT_ROUNDS = 10;

/** Duz metin sifreyi hash'ler - hash disinda hicbir yerde sifre saklanmaz */
async function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

/** Girilen sifre ile kayitli hash'i karsilastirir */
async function comparePassword(plainPassword, hash) {
  return bcrypt.compare(plainPassword, hash);
}

/** Kullanici icin imzali bir JWT uretir */
function generateToken(user) {
  if (!config.jwtSecret) {
    throw new Error('JWT_SECRET tanimli degil - .env dosyana ekle.');
  }
  return jwt.sign(
    { userId: user._id, username: user.username },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
}

/** Bir JWT'yi dogrular, gecerliyse payload'i dondurur, degilse null */
function verifyToken(token) {
  try {
    return jwt.verify(token, config.jwtSecret);
  } catch {
    return null;
  }
}

/**
 * Dogrulama/sifirlama baglantilari icin rastgele bir token uretir.
 * Bu token e-postayla kullaniciya gonderilir (duz hali); veritabaninda
 * ise sadece hash'i saklanir - sifrelerle ayni guvenlik mantigi.
 */
function generateRawToken() {
  return crypto.randomBytes(32).toString('hex');
}

/** Bir token'i (dogrulama/sifirlama) veritabaninda saklamak icin hash'ler */
function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

module.exports = { hashPassword, comparePassword, generateToken, verifyToken, generateRawToken, hashToken };
