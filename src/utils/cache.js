const NodeCache = require('node-cache');
const config = require('../config/config');

// checkperiod: suresi dolan keyleri periyodik temizler, bellek sismesin diye
const cache = new NodeCache({ checkperiod: 60 });
// Single-flight registry: concurrent misses for the same key share one upstream request.
const inFlight = new Map();

/**
 * Cache-aside deseni: once cache'e bak, yoksa/bayatsa fetchFn'i calistir,
 * sonucu cache'e yaz, geri don. Ayni veriyi her istekte yeniden cekmemek
 * hiz sorununun en buyuk cozumu.
 *
 * @param {string} key - benzersiz cache anahtari (orn. "match:12345:h2h")
 * @param {number} ttlSeconds - bu veri kac saniye taze sayilsin
 * @param {Function} fetchFn - cache bos oldugunda cagrilacak async fonksiyon
 */
async function getOrFetch(key, ttlSeconds, fetchFn) {
  const cached = cache.get(key);
  if (cached !== undefined) {
    return { ...cached, fromCache: true };
  }

  if (inFlight.has(key)) {
    const shared = await inFlight.get(key);
    return { ...shared, fromCache: false, coalesced: true };
  }
  const task = (async () => {
    const fresh = await fetchFn();
    if (fresh && fresh.ok !== false) cache.set(key, fresh, ttlSeconds);
    return fresh;
  })();
  inFlight.set(key, task);
  try {
    const fresh = await task;
    return { ...fresh, fromCache: false, coalesced: false };
  } finally {
    if (inFlight.get(key) === task) inFlight.delete(key);
  }
}

function set(key, value, ttlSeconds) {
  return cache.set(key, value, ttlSeconds);
}

function get(key) {
  return cache.get(key);
}

function del(key) {
  return cache.del(key);
}

module.exports = { getOrFetch, set, get, del, raw: cache, inFlight };
