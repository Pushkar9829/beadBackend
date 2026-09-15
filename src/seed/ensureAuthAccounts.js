const bcrypt = require('bcryptjs');
const User = require('../models/User');

async function ensureAuthAccounts() {
  const accounts = [
    {
      email: String(process.env.ADMIN_EMAIL || 'admin@kuberstones.com').toLowerCase().trim(),
      name: 'Kuberstones Admin',
      role: 'admin',
      password: process.env.ADMIN_PASSWORD || 'Admin@123',
    },
    {
      email: 'demo@kuberstones.com',
      name: 'Aarav Mehta',
      role: 'customer',
      password: 'Demo@123',
    },
  ];

  const created = [];
  for (const account of accounts) {
    const exists = await User.findOne({ email: account.email }).select('_id');
    if (exists) continue;
    await User.create({
      name: account.name,
      email: account.email,
      role: account.role,
      passwordHash: await bcrypt.hash(account.password, 10),
    });
    created.push(account.email);
  }
  return created;
}

module.exports = { ensureAuthAccounts };
