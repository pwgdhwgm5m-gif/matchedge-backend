const { Resend } = require('resend');
const config = require('../config/config');

const resend = config.resendApiKey ? new Resend(config.resendApiKey) : null;

async function sendEmail({ to, subject, html }) {
  if (!resend) {
    console.warn(`[email] RESEND_API_KEY tanımlı değil - "${subject}" e-postası gönderilemedi.`);
    return { sent: false, reason: 'not_configured' };
  }

  try {
    const response = await resend.emails.send({
      from: config.emailFrom,
      to,
      subject,
      html,
    });
    if (response?.error) {
      console.error('[email] Resend hatası:', response.error.message || response.error);
      return { sent: false, error: response.error.message || 'send_failed' };
    }
    return { sent: true };
  } catch (err) {
    console.error('[email] Gönderim hatası:', err.message);
    return { sent: false, error: err.message };
  }
}

async function sendVerificationEmail(to, { token, code }) {
  const link = `${config.frontendUrl}/verify.html?token=${encodeURIComponent(token)}&email=${encodeURIComponent(to)}`;
  return sendEmail({
    to,
    subject: 'SoccerEdge Pro doğrulama kodun',
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;background:#0a0e17;color:#f2f4f8;padding:28px;border-radius:18px;">
        <div style="font-size:20px;font-weight:800;margin-bottom:6px;">SOCCEREDGE <span style="color:#2dd4bf;">PRO</span></div>
        <p style="color:#a8b0c2;line-height:1.5;">Hesabını doğrulamak için aşağıdaki 6 haneli kodu SoccerEdge Pro ekranına yaz:</p>
        <div style="font-size:34px;font-weight:900;letter-spacing:9px;text-align:center;background:#121826;border:1px solid #2dd4bf;border-radius:14px;padding:18px;margin:22px 0;">${code}</div>
        <p style="text-align:center;"><a href="${link}" style="display:inline-block;background:#2dd4bf;color:#05201c;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:800;">E-postamı Doğrula</a></p>
        <p style="color:#7f899d;font-size:12px;line-height:1.5;">Kod ve bağlantı 15 dakika geçerlidir. Bu hesabı sen oluşturmadıysan e-postayı yok sayabilirsin.</p>
      </div>
    `,
  });
}

async function sendPasswordResetEmail(to, token) {
  const link = `${config.frontendUrl}/reset-password.html?token=${encodeURIComponent(token)}`;
  return sendEmail({
    to,
    subject: 'SoccerEdge Pro - Şifre sıfırlama',
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;">
        <h2>Şifre sıfırlama isteği</h2>
        <p>Yeni bir şifre belirlemek için aşağıdaki bağlantıya tıkla:</p>
        <p><a href="${link}" style="background:#2dd4bf;color:#05201c;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold;">Şifremi Sıfırla</a></p>
        <p style="color:#888;font-size:12px;">Bağlantı 1 saat geçerlidir. Bu isteği sen yapmadıysan e-postayı yok sayabilirsin.</p>
      </div>
    `,
  });
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail };
