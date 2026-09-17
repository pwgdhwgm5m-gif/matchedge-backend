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
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user',
    index: true,
  },
  lastLoginAt: { type: Date, default: null },
  lastActiveAt: { type: Date, default: null },
  loginCount: { type: Number, default: 0, min: 0 },
  xp: { type: Number, default: 0, min: 0, index: true },
  edgeCoins: { type: Number, default: 100, min: 0 },
  walletVersion: { type: Number, default: 0 },
  dailyLoginStreak: { type: Number, default: 0, min: 0, max: 7 },
  lastDailyClaimAt: { type: Date, default: null },
  totalCoinsWon: { type: Number, default: 0, min: 0 },
  totalCoinsSpent: { type: Number, default: 0, min: 0 },
  correctPicks: { type: Number, default: 0, min: 0 },
  wrongPicks: { type: Number, default: 0, min: 0 },
  currentStreak: { type: Number, default: 0, min: 0 },
  bestStreak: { type: Number, default: 0, min: 0 },
  chatRulesAcceptedAt: { type: Date, default: null },
  chatSuspendedUntil: { type: Date, default: null },
  blockedChatUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  verificationTokenHash: { type: String, default: null },
  verificationExpires: { type: Date, default: null },
  verificationCodeHash: { type: String, default: null },
  verificationCodeAttempts: { type: Number, default: 0, min: 0 },
  verificationLastSentAt: { type: Date, default: null },
  resetTokenHash: { type: String, default: null },
  resetExpires: { type: Date, default: null },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('User', userSchema);
