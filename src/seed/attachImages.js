require('dotenv').config();
const { connectDb } = require('../config/db');
const Product = require('../models/Product');
const Bead = require('../models/Bead');
const { slugifyName } = require('../utils/asyncHandler');

async function run() {
  await connectDb();

  const products = await Product.find();
  for (const p of products) {
    p.images = [`/catalog/products/${p.slug}.jpg`];
    await p.save();
    console.log('product', p.slug, p.images[0]);
  }

  const beads = await Bead.find();
  for (const b of beads) {
    const file = `/catalog/beads/bead-${slugifyName(b.name)}.jpg`;
    b.image = file;
    b.textureUrl = file;
    await b.save();
    console.log('bead', b.name, file);
  }

  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
