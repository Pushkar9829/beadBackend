/**
 * Guard for seed scripts that wipe or overwrite data.
 *
 * Refuses to run when NODE_ENV === 'production' or when MONGO_URI points at a non-local host,
 * unless BOTH the `--force` CLI flag and SEED_ALLOW_DESTRUCTIVE=yes are present.
 * Prints the target host / database (never credentials) before proceeding.
 */
const crypto = require('crypto');

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const DEFAULT_URI = 'mongodb://127.0.0.1:27017/kuberstones';

function describeMongoUri(uri = process.env.MONGO_URI || DEFAULT_URI) {
  const raw = String(uri || '');
  const match = raw.match(/^mongodb(\+srv)?:\/\/(?:[^@/]*@)?([^/?]+)(?:\/([^?]*))?/i);
  if (!match) return { hosts: [], dbName: '', srv: false, valid: false };
  const hosts = match[2]
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean)
    .map((h) => (h.startsWith('[') ? h.slice(0, h.indexOf(']') + 1) : h.split(':')[0]).toLowerCase());
  return { hosts, dbName: decodeURIComponent(match[3] || '') || '(default)', srv: Boolean(match[1]), valid: true };
}

function isLocalTarget(info) {
  return info.valid && !info.srv && info.hosts.length > 0 && info.hosts.every((h) => LOCAL_HOSTS.has(h));
}

/**
 * Exits the process (code 1) unless the destructive run is allowed.
 * @param {string} scriptName label used in messages
 * @param {string} action short description of what will be wiped/overwritten
 */
function assertDestructiveAllowed(scriptName, action) {
  const info = describeMongoUri();
  const target = info.valid ? `${info.hosts.join(',')} / db ${info.dbName}` : '(unparseable MONGO_URI)';
  console.log(`[${scriptName}] Target MongoDB: ${target}`);
  console.log(`[${scriptName}] This will ${action}.`);

  const isProd = process.env.NODE_ENV === 'production';
  const local = isLocalTarget(info);
  if (!isProd && local) return info;

  const forced = process.argv.includes('--force') && process.env.SEED_ALLOW_DESTRUCTIVE === 'yes';
  if (forced) {
    console.warn(`[${scriptName}] --force and SEED_ALLOW_DESTRUCTIVE=yes present; proceeding against ${isProd ? 'PRODUCTION env' : 'non-local host'}.`);
    return info;
  }
  console.error(
    `[${scriptName}] Refusing to run: ${isProd ? "NODE_ENV is 'production'" : 'MONGO_URI is not a localhost database'}. ` +
      'Re-run with the --force flag AND SEED_ALLOW_DESTRUCTIVE=yes if you really intend this.'
  );
  process.exit(1);
  return info;
}

/** Returns a strong random password (never print it). */
function randomPassword(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

module.exports = { assertDestructiveAllowed, describeMongoUri, isLocalTarget, randomPassword };
