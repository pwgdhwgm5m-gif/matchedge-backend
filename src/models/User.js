const mongoose = require('mongoose');

/**
 * Kullanici semasi. Sifre HICBIR ZAMAN duz metin olarak saklanmiyor -
 * sadece bcrypt ile hash'lenmis hali (passwordHash) tutuluyor.
 * Dogrulama/sifirlama token'lari da hash'lenmis olarak saklaniyor
 * (sifrelerle ayni mantik: veritabani sizsa bile token'lar duz okunamaz).
 */
const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    minlength: 3,
    maxlength: 30,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
  },
  passwordHash: {
    type: String,
    required: true,
  },
  emailVerified: {
    type: Boolean,
    default: false,
  },
  verificationTokenHash: { type: String, default: null },
  verificationExpires: { type: Date, default: null },
  resetTokenHash: { type: String, default: null },
  resetExpires: { type: Date, default: null },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('User', userSchema);
