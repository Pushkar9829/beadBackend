// WhatsApp Cloud API: sends the approved Authentication template (copy-code button) with a login code.
// Env: WHATSAPP_TOKEN (system-user token), WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_OTP_TEMPLATE (default
// otp_login), WHATSAPP_OTP_LANG (default en). WHATSAPP_MOCK=1 skips Meta for local tests (never in
// production).
const crypto = require('crypto');

const GRAPH = 'https://graph.facebook.com/v23.0';

function cfg() {
  return {
    token: String(process.env.WHATSAPP_TOKEN || '').trim(),
    phoneNumberId: String(process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim(),
    template: String(process.env.WHATSAPP_OTP_TEMPLATE || 'otp_login').trim(),
    lang: String(process.env.WHATSAPP_OTP_LANG || 'en').trim(),
    appSecret: String(process.env.WHATSAPP_APP_SECRET || '').trim(),
    verifyToken: String(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '').trim(),
  };
}

function isMock() {
  const flag = String(process.env.WHATSAPP_MOCK || '').trim().toLowerCase();
  return (flag === '1' || flag === 'true') && process.env.NODE_ENV !== 'production';
}

function isConfigured() {
  const c = cfg();
  return isMock() || Boolean(c.token && c.phoneNumberId);
}

/**
 * Customer input -> E.164 digits without "+". A 10-digit Indian mobile (6-9...) gets 91; "0" + 10 digits
 * too; anything with a country code (10-15 digits) is kept. Returns '' when it cannot be a mobile number.
 */
function normalizePhone(raw) {
  const text = String(raw ?? '').trim();
  let digits = text.replace(/\D/g, '');
  if (!digits) return '';
  if (text.startsWith('00')) digits = digits.slice(2);
  if (/^0[6-9]\d{9}$/.test(digits)) digits = `91${digits.slice(1)}`;
  else if (/^[6-9]\d{9}$/.test(digits) && !text.startsWith('+')) digits = `91${digits}`;
  if (digits.startsWith('91') && !/^91[6-9]\d{9}$/.test(digits)) return '';
  return /^[1-9]\d{9,14}$/.test(digits) ? digits : '';
}

/** "+91 98•••••382" for logs and the admin. */
function maskPhone(phone) {
  const d = String(phone || '');
  if (d.length < 6) return '•••';
  return `+${d.slice(0, d.length - 10)} ${d.slice(-10, -8)}${'•'.repeat(5)}${d.slice(-3)}`;
}

function newCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function fail(message, code, status = 502) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

/** Sends the code. Resolves { messageId }; throws with a customer-safe message on failure. */
async function sendOtp(phone, code) {
  if (isMock()) return { messageId: `mock.${crypto.randomBytes(8).toString('hex')}`, mock: true };
  const c = cfg();
  if (!c.token || !c.phoneNumberId) throw fail('WhatsApp login is not configured.', 'not_configured', 503);
  const body = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: phone,
    type: 'template',
    template: {
      name: c.template,
      language: { code: c.lang },
      components: [
        { type: 'body', parameters: [{ type: 'text', text: code }] },
        // Copy-code button: the button parameter carries the same code.
        { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
      ],
    },
  };
  let res;
  try {
    res = await fetch(`${GRAPH}/${c.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw fail('Could not reach WhatsApp. Please try again.', 'network');
  }
  const json = await res.json().catch(() => ({}));
  const id = json?.messages?.[0]?.id;
  if (res.ok && id) return { messageId: id };
  const e = json?.error || {};
  console.warn(`[whatsapp] send failed (${res.status}) code=${e.code || '-'} ${String(e.message || '').slice(0, 200)}`);
  // Meta 131026/131030/100 etc.: say it simply; the admin sees the detail in the log / stats.
  const invalidNumber = [131026, 131030, 131009, 100].includes(e.code);
  const err = fail(
    invalidNumber ? 'We could not send a WhatsApp code to this number. Check it is on WhatsApp, or sign in with email.' : 'WhatsApp could not send the code right now. Please try again or sign in with email.',
    'upstream'
  );
  err.detail = `${e.code || res.status}: ${String(e.message || '').slice(0, 200)}`;
  throw err;
}

/** X-Hub-Signature-256 check for webhook bodies (HMAC-SHA256 of the raw body with the app secret). */
function validSignature(rawBody, header) {
  const secret = cfg().appSecret;
  if (!secret || !rawBody || typeof header !== 'string' || !header.startsWith('sha256=')) return false;
  const expected = Buffer.from(`sha256=${crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`);
  const got = Buffer.from(header);
  return expected.length === got.length && crypto.timingSafeEqual(expected, got);
}

module.exports = { cfg, isMock, isConfigured, normalizePhone, maskPhone, newCode, sendOtp, validSignature };
