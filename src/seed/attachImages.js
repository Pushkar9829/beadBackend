require('dotenv').config();
const { connectDb } = require('../config/db');
const { assertDestructiveAllowed } = require('./destructiveGuard');
const { uploadSeedMedia } = require('./uploadSeedMedia');

async function run() {
  assertDestructiveAllowed('attachImages', 'upload seed media and OVERWRITE image fields on beads, products, purposes, charms, banners, home content and store logo');
  await connectDb();
  const result = await uploadSeedMedia();
  console.log('Images attached / uploaded.', result);
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
