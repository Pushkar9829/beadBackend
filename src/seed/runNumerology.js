require('dotenv').config();
const { connectDb } = require('../config/db');
const { assertDestructiveAllowed } = require('./destructiveGuard');
const { seedNumerologyMappings } = require('./seedNumerology');

async function run() {
  assertDestructiveAllowed('seed:numerology', 'DELETE all MulankCrystal and ZodiacBead mappings, re-create them from defaults, and reset zodiacBeadCount to 2');
  await connectDb();
  const result = await seedNumerologyMappings();
  console.log('Numerology mappings seeded.', result);
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
