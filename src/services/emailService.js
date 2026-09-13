const { Resend } = require('resend');
const config = require('../config/config');

const resend = config.resendApiKey ? new Resend(config.resendApiKey) : null;

/**
 * E-posta gonderimi best-effort'tur: RESEND_API_KEY tanimli degilse
 * (veya gonderim basarisiz olursa) hata firlatmaz, sadece uyari loglar.
 * Boylece e-posta servisi kurulmadan once diger her sey (kayit, giris)
 * calismaya devam eder - sadece dogrulama/sifirlama postasi gitmez.
 */
async function sendEmail({ to, subject, html }) {
  if (!resend) {
    console.warn(`[email] RESEND_API_KEY tanimli degil - "${subject}" postasi ${to} adresine GONDERILEMEDI.`);
    return { sent: false };
  }

  try {
    await resend.emails.send({
      from: config.emailFrom,
      to,
      subject,
      html,
    });
    return { sent: true };
  } catch (err) {
    console.error(`[email] Gonderim hatasi (${to}):`, err.message);
    return { sent: false, error: err.message };
  }
}

async function sendVerificationEmail(to, token) {
  const link = `${config.frontendUrl}/verify.html?token=${token}`;
  return sendEmail({
    to,
    subject: 'MatchEdge - E-postanÄ± DoÄŸrula',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>MatchEdge'e HoÅŸ Geldin</h2>
        <p>HesabÄ±nÄ± aktifleÅŸtirmek iÃ§in aÅŸaÄŸÄ±daki baÄŸlantÄ±ya tÄ±kla:</p>
        <p><a href="${link}" style="background:#2dd4bf;color:#05201c;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold;">E-postamÄ± DoÄŸrula</a></p>
        <p style="color:#888;font-size:12px;">BaÄŸlantÄ± 24 saat geÃ§erlidir. Bu isteÄŸi sen yapmadÄ±ysan bu postayÄ± yok sayabilirsin.</p>
      </div>
    `,
  });
}

async function sendPasswordResetEmail(to, token) {
  const link = `${config.frontendUrl}/reset-password.html?token=${token}`;
  return sendEmail({
    to,
    subject: 'MatchEdge - Åžifre SÄ±fÄ±rlama',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Åžifre SÄ±fÄ±rlama Ä°steÄŸi</h2>
        <p>Yeni bir ÅŸifre belirlemek iÃ§in aÅŸaÄŸÄ±daki baÄŸlantÄ±ya tÄ±kla:</p>
        <p><a href="${link}" style="background:#2dd4bf;color:#05201c;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold;">Åžifremi SÄ±fÄ±rla</a></p>
        <p style="color:#888;font-size:12px;">BaÄŸlantÄ± 1 saat geÃ§erlidir. Bu isteÄŸi sen yapmadÄ±ysan bu postayÄ± yok sayabilirsin, ÅŸifren deÄŸiÅŸmeyecek.</p>
      </div>
    `,
  });
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail };
