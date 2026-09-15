/** Per-bead ₹ from Qubestone BEAD PRICE SOURCE. Red Jasper is not in that sheet. */

const BEAD_PRICE_SOURCE = {
  'Tiger Eye': 5.75,
  Amethyst: 18,
  Moonstone: 23,
  Citrine: 29,
  'Rose Quartz': 7,
  Pyrite: 14,
  'Clear Quartz': 23,
  'Black Tourmaline': 22,
  Fluorite: 18,
  Hematite: 4.5,
  Carnelian: 16,
  Lepidolite: 50,
  'Smoky Quartz': 64,
  'Obsidian / Black Obsidian': 22,
  Obsidian: 22,
  'Black Obsidian': 22,
  Howlite: 20,
  Rhodonite: 28,
  Garnet: 72,
  'Green Aventurine': 35,
  'Strawberry Quartz': 100,
  Sunstone: 100,
  'Blue Lace Agate': 467,
  Shungite: 134,
};

function catalogPriceFor(name) {
  if (!name) return null;
  if (BEAD_PRICE_SOURCE[name] != null) return BEAD_PRICE_SOURCE[name];
  const key = Object.keys(BEAD_PRICE_SOURCE).find(
    (n) => n.toLowerCase() === String(name).toLowerCase()
  );
  return key == null ? null : BEAD_PRICE_SOURCE[key];
}

module.exports = { BEAD_PRICE_SOURCE, catalogPriceFor };
