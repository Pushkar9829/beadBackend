const HOME_LAYOUT_DEFAULTS = [
  { key: 'hero', label: 'Hero banner', enabled: true, sortOrder: 0 },
  { key: 'marquee', label: 'Marquee', enabled: true, sortOrder: 1 },
  { key: 'houses', label: 'Featured categories', enabled: true, sortOrder: 2 },
  { key: 'studio', label: 'Studio invite', enabled: true, sortOrder: 3 },
  { key: 'shop_by_purpose', label: 'Shop by purpose', enabled: true, sortOrder: 4 },
  { key: 'ritual', label: 'Ritual steps', enabled: true, sortOrder: 5 },
  { key: 'featured', label: 'Featured products', enabled: true, sortOrder: 6 },
  { key: 'bestsellers', label: 'Best sellers', enabled: true, sortOrder: 7 },
  { key: 'new_arrivals', label: 'New arrivals', enabled: true, sortOrder: 8 },
  { key: 'trending', label: 'Trending bracelets', enabled: true, sortOrder: 9 },
  { key: 'testimonials', label: 'Testimonials', enabled: true, sortOrder: 10 },
  { key: 'trust', label: 'Trust claims', enabled: true, sortOrder: 11 },
  { key: 'faq', label: 'FAQ', enabled: true, sortOrder: 12 },
  { key: 'journal', label: 'Journal', enabled: true, sortOrder: 13 },
  { key: 'newsletter', label: 'Newsletter', enabled: true, sortOrder: 14 },
  { key: 'finale', label: 'Finale', enabled: true, sortOrder: 15 },
];

function mergeHomeLayout(stored) {
  const byKey = new Map((Array.isArray(stored) ? stored : []).map((s) => [s.key, s]));
  return HOME_LAYOUT_DEFAULTS.map((def) => {
    const extra = byKey.get(def.key) || {};
    return {
      ...def,
      ...extra,
      key: def.key,
      label: extra.label || def.label,
      enabled: extra.enabled !== false,
      sortOrder: extra.sortOrder ?? def.sortOrder,
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

module.exports = { HOME_LAYOUT_DEFAULTS, mergeHomeLayout, sectionLive };
