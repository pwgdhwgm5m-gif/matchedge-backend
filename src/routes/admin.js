const express = require('express');
const User = require('../models/User');
const LoginEvent = require('../models/LoginEvent');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireAdmin } = require('../middleware/adminMiddleware');

const router = express.Router();

router.use(requireAuth, requireAdmin);

router.get('/users', async (req, res) => {
  try {
    const users = await User.find({})
      .select('username email emailVerified role createdAt lastLoginAt lastActiveAt loginCount')
      .sort({ createdAt: -1 })
      .lean();
    const recentLogins = await LoginEvent.find({})
      .select('userId loginAt country city district countryCode timezone userAgent')
      .populate('userId', 'username email')
      .sort({ loginAt: -1 })
      .limit(200)
      .lean();

    res.json({
      total: users.length,
      verified: users.filter(user => user.emailVerified).length,
      admins: users.filter(user => user.role === 'admin').length,
      users,
      recentLogins,
    });
  } catch (error) {
    console.error('[admin/users] Hata:', error.message);
    res.status(500).json({ error: 'Kullanici listesi alinamadi.' });
  }
});

module.exports = router;
