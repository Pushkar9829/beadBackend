const Notification = require('../models/Notification');
const StoreSettings = require('../models/StoreSettings');

async function notify({ type, title, body, link, meta }) {
  const settings = await StoreSettings.findOne({ key: 'store' }).lean();
  const flags = settings?.notifications || {};
  const channels = [];
  if (flags.email) channels.push('email');
  if (flags.sms) channels.push('sms');
  if (flags.whatsapp) channels.push('whatsapp');
  const doc = await Notification.create({
    type: type || 'system',
    title,
    body,
    link,
    meta: meta || {},
    channels,
  });
  return doc;
}

async function unreadCount() {
  return Notification.countDocuments({ read: false });
}

module.exports = { notify, unreadCount };
