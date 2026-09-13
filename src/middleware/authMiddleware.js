const { verifyToken } = require('../services/authService');

/**
 * Korunan route'lardan once calisir. "Authorization: Bearer <token>"
 * basligini bekler. Gecerliyse req.user'i doldurup devam eder,
 * degilse 401 doner.
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Giris yapmaniz gerekiyor.' });
  }

  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Oturum gecersiz veya suresi dolmus, tekrar giris yapin.' });
  }

  req.user = payload; // { userId, username }
  next();
}

module.exports = { requireAuth };
