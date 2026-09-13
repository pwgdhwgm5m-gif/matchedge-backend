const mongoose = require('mongoose');
const config = require('./config/config');

/**
 * MongoDB Atlas'a baglanir. Baglanti bilgisi yoksa (MONGODB_URI bos)
 * sunucu yine de ayaga kalkar ama giris/kayit endpoint'leri calismaz -
 * bu sayede DB kurulmadan once diger tum ozellikleri (analiz, canli
 * takip vb.) test etmeye devam edebilirsin.
 */
async function connectDB() {
  if (!config.mongoUri) {
    console.warn('[db] MONGODB_URI tanimli degil - kullanici hesabi ozellikleri devre disi kalacak.');
    return;
  }

  try {
    await mongoose.connect(config.mongoUri);
    console.log('[db] MongoDB baglantisi basarili.');
  } catch (err) {
    console.error('[db] MongoDB baglanti hatasi:', err.message);
  }
}

module.exports = { connectDB };
