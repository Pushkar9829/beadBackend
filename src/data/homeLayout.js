// Home layout v2 ("Nocturne"). Bump HOME_LAYOUT_VERSION whenever the default section list/order changes:
// stored layouts saved under an older version keep their enabled/schedule flags but adopt the new order.
const HOME_LAYOUT_VERSION = 2;

const HOME_LAYOUT_DEFAULTS = [
  { key: 'hero', label: 'Hero', enabled: true, sortOrder: 0 },
  { key: 'facts', label: 'Facts strip', enabled: true, sortOrder: 1 },
  { key: 'houses', label: 'Houses & studio', enabled: true, sortOrder: 2 },
  { key: 'collection', label: 'Collection carousel', enabled: true, sortOrder: 3 },
  { key: 'flash_sale', label: 'Flash sale', enabled: true, sortOrder: 4 },
  { key: 'look', label: 'Shop the look', enabled: true, sortOrder: 5 },
  { key: 'finder', label: 'Stone finder', enabled: true, sortOrder: 6 },
  { key: 'purposes', label: 'Shop by purpose', enabled: true, sortOrder: 7 },
  { key: 'craft', label: 'The craft', enabled: true, sortOrder: 8 },
  { key: 'reviews', label: 'Reviews', enabled: true, sortOrder: 9 },
  { key: 'journal', label: 'Journal', enabled: true, sortOrder: 10 },
  { key: 'newsletter', label: 'Newsletter', enabled: true, sortOrder: 11 },
  { key: 'finale', label: 'Closing banner', enabled: true, sortOrder: 12 },
];

// v1 key -> v2 key, for carrying enabled/startsAt/endsAt across the migration.
const LEGACY_KEY_MAP = {
  hero: 'hero',
  flash_sale: 'flash_sale',
  houses: 'houses',
  journal: 'journal',
  newsletter: 'newsletter',
  finale: 'finale',
  featured: 'collection',
  shop_by_purpose: 'purposes',
  testimonials: 'reviews',
  trust: 'craft',
};

function mergeHomeLayout(stored, storedVersion) {
  const rows = (Array.isArray(stored) ? stored : []).filter((s) => s && typeof s === 'object' && s.key);
  const current = Number(storedVersion) === HOME_LAYOUT_VERSION;
  const byKey = new Map();
  for (const row of rows) {
    const key = current ? row.key : LEGACY_KEY_MAP[row.key];
    if (key && !byKey.has(key)) byKey.set(key, row);
  }
  return HOME_LAYOUT_DEFAULTS.map((def) => {
    const extra = byKey.get(def.key) || {};
    const sortOrder = current && Number.isFinite(Number(extra.sortOrder)) ? Number(extra.sortOrder) : def.sortOrder;
    return {
      key: def.key,
      label: (current && extra.label) || def.label,
      enabled: extra.enabled !== false,
      sortOrder,
      startsAt: extra.startsAt || null,
      endsAt: extra.endsAt || null,
    };
  }).sort((a, b) => a.sortOrder - b.sortOrder);
}

function sectionLive(section, now = new Date()) {
  if (!section || section.enabled === false) return false;
  if (section.startsAt && new Date(section.startsAt) > now) return false;
  if (section.endsAt && new Date(section.endsAt) < now) return false;
  return true;
}

module.exports = { HOME_LAYOUT_VERSION, HOME_LAYOUT_DEFAULTS, mergeHomeLayout, sectionLive };
