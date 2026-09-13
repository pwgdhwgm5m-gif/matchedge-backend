const axios = require('axios');

/**
 * Dis API cagrilarini timeout ile sarmalar.
 * Bir kaynak yanit vermezse tum zinciri kilitlemesin diye kritik.
 *
 * @param {object} options - axios istek ayarlari (url, headers, params...)
 * @param {number} timeoutMs - milisaniye cinsinden timeout (varsayilan 6000)
 * @param {string} label - loglama icin kaynak adi (orn. "API-Football H2H")
 */
async function fetchT(options, timeoutMs = 6000, label = 'unknown-source') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await axios({
      ...options,
      signal: controller.signal,
      timeout: timeoutMs,
    });
    clearTimeout(timer);
    return { ok: true, source: label, data: response.data };
  } catch (err) {
    clearTimeout(timer);
    const reason = err.code === 'ECONNABORTED' || err.name === 'CanceledError'
      ? 'timeout'
      : (err.response ? `http_${err.response.status}` : 'network_error');

    console.error(`[fetchT] ${label} basarisiz: ${reason} - ${err.message}`);
    return { ok: false, source: label, error: reason };
  }
}

module.exports = { fetchT };
