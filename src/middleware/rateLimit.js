const buckets = new Map();

function clientKey(req) {
  // Express derives req.ip according to the configured trusted proxy count.
  // Reading X-Forwarded-For directly would let a client rotate a spoofed value.
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function rateLimit({ windowMs = 15 * 60 * 1000, max = 60, keyPrefix = 'api' } = {}) {
  return (req, res, next) => {
    const key = `${keyPrefix}:${clientKey(req)}`;
    const now = Date.now();
    const current = buckets.get(key);
    if (!current || current.resetAt <= now) {
      // Keep the local limiter bounded on long-running single-instance services.
      if (buckets.size > 20_000) {
        for (const [bucketKey, bucket] of buckets) {
          if (bucket.resetAt <= now) buckets.delete(bucketKey);
        }
      }
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    current.count += 1;
    if (current.count > max) {
      const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'Cok fazla istek gonderildi. Lutfen daha sonra tekrar deneyin.' });
    }
    next();
  };
}

function clearRateLimitBuckets() {
  buckets.clear();
}

module.exports = { rateLimit, clearRateLimitBuckets };