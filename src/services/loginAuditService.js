const crypto = require('crypto');
const LoginEvent = require('../models/LoginEvent');
const config = require('../config/config');

function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || '';
}

function isPublicIp(ip) {
  return ip && !/^(::1|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
}

async function resolveApproximateLocation(ip, fallbackCountryCode, clientTimezone) {
  const fallback = {
    country: '',
    city: '',
    district: '',
    region: '',
    countryCode: fallbackCountryCode || '',
    timezone: clientTimezone || '',
  };
  if (!isPublicIp(ip)) return fallback;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1800);
  try {
    const response = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, { signal: controller.signal });
    if (!response.ok) return fallback;
    const data = await response.json();
    if (!data.success) return fallback;
    return {
      // For Turkish addresses the provider's region is the province/city,
      // while city is the smaller locality. Keep both labels explicit.
      city: data.region || data.city || '',
      district: data.city && data.city !== data.region ? data.city : '',
      region: data.region || '',
      country: data.country || '',
      countryCode: data.country_code || fallbackCountryCode || '',
      timezone: data.timezone?.id || clientTimezone || '',
    };
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

async function recordLoginEvent({ user, req, clientTimezone, geoConsent }) {
  const ip = clientIp(req);
  const location = geoConsent === true
    ? await resolveApproximateLocation(ip, req.headers['cf-ipcountry'], clientTimezone)
    : { country:'', city:'', district:'', region:'', countryCode:'', timezone:clientTimezone || '' };
  const ipHash = ip
    ? crypto.createHmac('sha256', config.jwtSecret).update(ip).digest('hex')
    : '';

  await LoginEvent.create({
    userId: user._id,
    geoConsent: geoConsent === true,
    ...location,
    ipHash,
    userAgent: String(req.headers['user-agent'] || '').slice(0, 240),
  });
}

module.exports = { recordLoginEvent };
