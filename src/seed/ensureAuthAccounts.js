const User = require('../models/User');
const { normalizePhone } = require('../services/whatsappService');

/**
 * Makes sure the store owner can sign in. Everyone signs in with a WhatsApp code, so the admin is the
 * account whose WhatsApp number is ADMIN_PHONE (env / AWS settings), e.g. 919812345678 or +91 98123 45678.
 * - No account with that number yet: creates "Kuberstones Admin" with that number.
 * - An account exists (e.g. it signed up as a customer): promotes it to admin.
 * Never demotes anyone and never touches other accounts.
 */
async function ensureAuthAccounts() {
  const raw = String(process.env.ADMIN_PHONE || '').trim();
  if (!raw) {
    console.warn('[ensureAuthAccounts] ADMIN_PHONE not set; no admin bootstrap.');
    return [];
  }
  const phone = normalizePhone(raw);
  if (!phone) {
    console.warn('[ensureAuthAccounts] ADMIN_PHONE is not a valid mobile number; no admin bootstrap.');
    return [];
  }
  const existing = await User.findOne({ whatsappPhone: phone });
  if (existing) {
    if (existing.role !== 'admin' || existing.isActive === false) {
      await User.updateOne({ _id: existing._id }, { $set: { role: 'admin', isActive: true }, $inc: { tokenVersion: 1 } });
      console.log('[ensureAuthAccounts] ADMIN_PHONE account promoted to admin.');
      return ['promoted'];
    }
    return [];
  }
  await User.create({ name: 'Kuberstones Admin', role: 'admin', phone: `+${phone}`, whatsappPhone: phone, isActive: true });
  console.log('[ensureAuthAccounts] admin account created for ADMIN_PHONE.');
  return ['created'];
}

module.exports = { ensureAuthAccounts, MIN_ADMIN_PASSWORD_LENGTH: 12 };
