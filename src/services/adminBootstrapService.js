const mongoose = require('mongoose');
const User = require('../models/User');
const { hashPassword } = require('./authService');
const config = require('../config/config');

// One-time provisioning secret lives only in Render environment, never source control.
async function bootstrapAdmin() {
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  if (!password || !config.adminUsername || mongoose.connection.readyState !== 1) return;
  const targetName = config.adminUsername;
  if (password.length < 12) throw new Error('Admin password must be at least 12 characters.');
  const existing = await User.findOne({username: targetName});
  if (existing) {
    // Once the reserved account exists, never overwrite its user-chosen password on restart.
    // Bootstrap is provisioning-only; role repair is safe, password rotation belongs to auth flows.
    existing.role = 'admin';
    existing.emailVerified = true;
    await existing.save();
  } else {
    const hash = await hashPassword(password);
    const previousAdmin = await User.findOne({role:'admin'}).sort({createdAt:1});
    if (previousAdmin) {
      previousAdmin.username = targetName;
      previousAdmin.passwordHash = hash;
      previousAdmin.emailVerified = true;
      await previousAdmin.save();
    } else {
      await User.create({
        username: targetName,
        email: targetName + '@internal.socceredgepro.com',
        passwordHash: hash, role:'admin', emailVerified:true,
      });
    }
  }
  console.log('[admin-bootstrap] Authorized admin account provisioned; remove ADMIN_BOOTSTRAP_PASSWORD from service environment.');
}
module.exports = { bootstrapAdmin };
