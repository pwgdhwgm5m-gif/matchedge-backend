const crypto = require('crypto');
const LoginEvent = require('../models/LoginEvent');
const config = require('../config/config');

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const real = String(req.headers['x-real-ip'] || '').trim();
  const raw = forwarded || real || req.ip || req.socket?.remoteAddress || '';
  return String(raw).replace(/^::ffff:/, '').trim();
}

function isPublicIp(ip) {
  return ip && !/^(::1|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
}

async function resolveApproximateLocation(ip, fallbackCountryCode, clientTimezone) {
  const fallback = { country:'', city:'', district:'', region:'', countryCode:fallbackCountryCode||'', timezone:clientTimezone||'' };
  if (!isPublicIp(ip)) return fallback;
  const normalize = d => ({
    city: d.region || d.regionName || d.city || '',
    district: d.city && d.city !== (d.region || d.regionName) ? d.city : (d.district || ''),
    region: d.region || d.regionName || '',
    country: d.country || '',
    countryCode: d.country_code || d.countryCode || fallbackCountryCode || '',
    timezone: d.timezone?.id || d.timezone || clientTimezone || ''
  });
  const providers = [
    async signal => {
      const r=await fetch('https://ipwho.is/'+encodeURIComponent(ip),{signal});
      if(!r.ok) throw new Error('ipwho');
      const d=await r.json();
      if(d.success===false) throw new Error('ipwho');
      return normalize(d);
    },
    async signal => {
      const r=await fetch('http://ip-api.com/json/'+encodeURIComponent(ip)+'?fields=status,country,countryCode,regionName,city,district,timezone',{signal});
      if(!r.ok) throw new Error('ipapi');
      const d=await r.json();
      if(d.status!=='success') throw new Error('ipapi');
      return normalize(d);
    }
  ];
  for (const provider of providers) {
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),2500);
    try {
      const loc=await provider(controller.signal);
      if(loc.city || loc.district || loc.region) return loc;
    } catch (_) {
    } finally { clearTimeout(timer); }
  }
  return fallback;
}

async function recordLoginEvent({ user, req, clientTimezone, geoConsent }) {
  const ip = clientIp(req);
  // Approximate IP-based location only; does not request browser/GPS location permission.
  const location = await resolveApproximateLocation(
    ip,
    req.headers['cf-ipcountry'],
    clientTimezone
  );
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

async function setLocationConsent({ userId, req, clientTimezone, consent }) {
  const clearedLocation = {
    city: '', district: '', region: '', country: '', countryCode: '',
    timezone: clientTimezone || '',
  };

  if (consent !== true) {
    await LoginEvent.updateMany(
      { userId },
      {
        $set: {
          geoConsent: false,
          geoConsentAt: null,
          ...clearedLocation,
        },
      }
    );
    return { consent: false };
  }

  const ip = clientIp(req);
  const location = await resolveApproximateLocation(
    ip,
    req.headers['cf-ipcountry'],
    clientTimezone
  );
  const update = {
    geoConsent: true,
    geoConsentAt: new Date(),
    ...location,
  };

  const latest = await LoginEvent.findOneAndUpdate(
    { userId },
    { $set: update },
    { sort: { loginAt: -1 }, new: true }
  );

  if (!latest) {
    const ipHash = ip
      ? crypto.createHmac('sha256', config.jwtSecret).update(ip).digest('hex')
      : '';
    await LoginEvent.create({
      userId,
      ...update,
      ipHash,
      userAgent: String(req.headers['user-agent'] || '').slice(0, 240),
    });
  }

  return { consent: true, location };
}

module.exports = { recordLoginEvent, setLocationConsent, clientIp, resolveApproximateLocation };
