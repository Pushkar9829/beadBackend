require('dotenv').config();
const { connectDb } = require('../config/db');
const { seedNumerologyMappings } = require('./seedNumerology');

async function run() {
  await connectDb();
  const result = await seedNumerologyMappings();
  console.log('Numerology mappings seeded.', result);
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
