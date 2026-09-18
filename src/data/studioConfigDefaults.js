const DEFAULT_THREAD_TYPES = [
  { key: 'korean-elastic', label: 'Korean elastic thread', detail: 'Free-size fit' },
  { key: 'steel-core', label: 'Steel core thread', detail: 'Cut to your wrist size' },
];

const DEFAULT_CZ_OPTIONS = [
  { key: 'cz', label: 'CZ', detail: 'Classic cut accent.', price: 6 },
  { key: 'round', label: 'Round CZ', detail: 'Round cut accent.', price: 8 },
];

const DEFAULT_PACKAGING_LABELS = {
  box: 'Box',
  clasp: 'Clasp',
  charm: 'Charm',
  cz: 'CZ',
  roundCz: 'Round CZ',
  thread: 'Thread',
};

const DEFAULT_STUDIO_MODES = [
  {
    slug: 'purpose',
    label: 'Customise by purpose',
    short: 'Purpose',
    eyebrow: 'Studio',
    title: 'Customise by purpose',
    body: 'Begin with why you wear it. One purpose opens its intentions.',
    chooseHint: 'Choose a purpose, then pick your intentions.',
    isActive: true,
    sortOrder: 1,
  },
  {
    slug: 'numerology',
    label: 'Customise by numerology',
    short: 'Numerology',
    eyebrow: 'Mulank · Bhagyank',
    title: 'Customise by numerology',
    body: 'Mulank and Bhagyank stay as two separate layers. Use one or both.',
    chooseHint: 'Choose a Mulank or Bhagyank number to continue.',
    isActive: true,
    sortOrder: 2,
  },
  {
    slug: 'zodiac',
    label: 'Customise by zodiac sign',
    short: 'Zodiac',
    eyebrow: 'Rashi',
    title: 'Customise by zodiac sign',
    body: 'Twelve signs, each with a recommended crystal core.',
    chooseHint: 'Choose your zodiac sign to continue.',
    isActive: true,
    sortOrder: 3,
  },
  {
    slug: 'planetary',
    label: 'Customise by planetary',
    short: 'Planetary',
    eyebrow: 'Graha',
    title: 'Customise by planetary',
    body: 'Choose a planet. Traditional crystal associations become the strand.',
    chooseHint: 'Choose a planet to continue.',
    isActive: true,
    sortOrder: 4,
  },
  {
    slug: 'profession',
    label: 'Customise by profession',
    short: 'Profession',
    eyebrow: 'Work',
    title: 'Customise by profession',
    body: 'Choose the work you do. The atelier suggests crystals for that field.',
    chooseHint: 'Choose the work you do to continue.',
    isActive: true,
    sortOrder: 5,
  },
];

function withStudioDefaults(raw) {
  const config = raw ? { ...(typeof raw.toObject === 'function' ? raw.toObject() : raw) } : {};
  if (!Array.isArray(config.beadSizesMm) || !config.beadSizesMm.length) config.beadSizesMm = [6, 8, 10];
  if (!Array.isArray(config.wristSizes) || !config.wristSizes.length) {
    config.wristSizes = ['5.5"', '6"', '6.5"', '7"', '7.5"', '8"'];
  }
  if (!Array.isArray(config.threadTypes) || !config.threadTypes.length) {
    config.threadTypes = DEFAULT_THREAD_TYPES.map((row) => ({ ...row }));
  }
  if (!Array.isArray(config.czOptions) || !config.czOptions.length) {
    config.czOptions = DEFAULT_CZ_OPTIONS.map((row) => ({ ...row }));
  }
  if (!Array.isArray(config.studioModes) || !config.studioModes.length) {
    config.studioModes = DEFAULT_STUDIO_MODES.map((row) => ({ ...row }));
  }
  config.packagingLabels = { ...DEFAULT_PACKAGING_LABELS, ...(config.packagingLabels || {}) };
  if (config.crystalMin == null) config.crystalMin = 3;
  if (config.crystalMax == null) config.crystalMax = 5;
  if (config.crystalMaxNumerology == null) config.crystalMaxNumerology = 8;
  if (config.intentionCap == null) config.intentionCap = 3;
  if (config.engravingMaxLength == null) config.engravingMaxLength = 24;
  if (config.charmRequired == null) config.charmRequired = true;
  if (!config.defaultThreadType) config.defaultThreadType = config.threadTypes[0]?.key || 'korean-elastic';
  if (!config.defaultCzStyle) config.defaultCzStyle = config.czOptions[0]?.key || 'cz';
  if (!config.charmHint) config.charmHint = 'Choose a charm to continue.';
  return config;
}

function activeStudioModes(config) {
  const merged = withStudioDefaults(config);
  return (merged.studioModes || [])
    .filter((mode) => mode && mode.slug && mode.isActive !== false)
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
    .map((mode) => ({
      ...mode,
      path: `/customize?path=${mode.slug}`,
    }));
}

module.exports = {
  DEFAULT_THREAD_TYPES,
  DEFAULT_CZ_OPTIONS,
  DEFAULT_PACKAGING_LABELS,
  DEFAULT_STUDIO_MODES,
  withStudioDefaults,
  activeStudioModes,
};
