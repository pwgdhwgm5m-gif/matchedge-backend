const User = require('../models/User');

async function requireAdmin(req, res, next) {
  try {
    const user = await User.findById(req.user.userId).select('role username');
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin yetkisi gerekli.' });
    }
    req.admin = user;
    next();
  } catch (error) {
    console.error('[admin/auth] Hata:', error.message);
    res.status(500).json({ error: 'Admin yetkisi dogrulanamadi.' });
  }
}

module.exports = { requireAdmin };
