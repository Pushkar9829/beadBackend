require('dotenv').config();
const { connectDb } = require('../config/db');
const { uploadSeedMedia } = require('./uploadSeedMedia');

async function run() {
  await connectDb();
  const result = await uploadSeedMedia();
  console.log('Images attached / uploaded.', result);
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
