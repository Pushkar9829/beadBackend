const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const User = require('../models/User');

const MIN_ADMIN_PASSWORD_LENGTH = 12;

/**
 * Runs on every server start. Insert-only:
 * - Never uses a hardcoded admin password. Admin is created only when ADMIN_EMAIL and
 *   ADMIN_PASSWORD (>= 12 chars) are set.
 * - Demo customer is created only outside production and only when SEED_DEMO_USER === 'true'
 *   (password from DEMO_PASSWORD, otherwise random).
 * - Existing accounts are never modified (passwords are never reset).
 * - Passwords are never logged.
 */
function plannedAccounts() {
  const accounts = [];

  const adminEmail = String(process.env.ADMIN_EMAIL || '').toLowerCase().trim();
  const adminPassword = String(process.env.ADMIN_PASSWORD || '');
  if (!adminEmail || !adminPassword) {
    console.warn('[ensureAuthAccounts] ADMIN_EMAIL / ADMIN_PASSWORD not set; skipping admin bootstrap.');
  } else if (adminPassword.length < MIN_ADMIN_PASSWORD_LENGTH) {
    console.warn(
      `[ensureAuthAccounts] ADMIN_PASSWORD must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters; skipping admin bootstrap.`
    );
  } else {
    accounts.push({ email: adminEmail, name: 'Kuberstones Admin', role: 'admin', password: adminPassword });
  }

  if (process.env.NODE_ENV !== 'production' && process.env.SEED_DEMO_USER === 'true') {
    if (!process.env.DEMO_PASSWORD) {
      console.warn('[ensureAuthAccounts] DEMO_PASSWORD not set; demo user (if created) gets a random password (not shown).');
    }
    accounts.push({
      email: String(process.env.DEMO_EMAIL || 'demo@kuberstones.com').toLowerCase().trim(),
      name: 'Aarav Mehta',
      role: 'customer',
      password: process.env.DEMO_PASSWORD || crypto.randomBytes(24).toString('base64url'),
    });
  }
  return accounts;
}

async function ensureAuthAccounts() {
  const created = [];
  for (const account of plannedAccounts()) {
    const exists = await User.findOne({ email: account.email }).select('_id');
    if (exists) continue; // never reset or modify existing accounts
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

module.exports = { ensureAuthAccounts, MIN_ADMIN_PASSWORD_LENGTH };
