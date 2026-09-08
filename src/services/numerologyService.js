const ZODIAC_FALLBACK = [
  { sign: 'Capricorn', slug: 'capricorn', fromMonth: 12, fromDay: 22, toMonth: 1, toDay: 19, beadName: 'Black Tourmaline' },
  { sign: 'Aquarius', slug: 'aquarius', fromMonth: 1, fromDay: 20, toMonth: 2, toDay: 18, beadName: 'Amethyst' },
  { sign: 'Pisces', slug: 'pisces', fromMonth: 2, fromDay: 19, toMonth: 3, toDay: 20, beadName: 'Labradorite' },
  { sign: 'Aries', slug: 'aries', fromMonth: 3, fromDay: 21, toMonth: 4, toDay: 19, beadName: 'Carnelian' },
  { sign: 'Taurus', slug: 'taurus', fromMonth: 4, fromDay: 20, toMonth: 5, toDay: 20, beadName: 'Rose Quartz' },
  { sign: 'Gemini', slug: 'gemini', fromMonth: 5, fromDay: 21, toMonth: 6, toDay: 20, beadName: 'Tiger Eye' },
  { sign: 'Cancer', slug: 'cancer', fromMonth: 6, fromDay: 21, toMonth: 7, toDay: 22, beadName: 'Moonstone' },
  { sign: 'Leo', slug: 'leo', fromMonth: 7, fromDay: 23, toMonth: 8, toDay: 22, beadName: 'Citrine' },
  { sign: 'Virgo', slug: 'virgo', fromMonth: 8, fromDay: 23, toMonth: 9, toDay: 22, beadName: 'Sodalite' },
  { sign: 'Libra', slug: 'libra', fromMonth: 9, fromDay: 23, toMonth: 10, toDay: 22, beadName: 'Lapis Lazuli' },
  { sign: 'Scorpio', slug: 'scorpio', fromMonth: 10, fromDay: 23, toMonth: 11, toDay: 21, beadName: 'Garnet' },
  { sign: 'Sagittarius', slug: 'sagittarius', fromMonth: 11, fromDay: 22, toMonth: 12, toDay: 21, beadName: 'Pyrite' },
];

const MULANK_FALLBACK = {
  1: { beadName: 'Garnet', reason: 'Mulank 1 is calibrated with Garnet for rooted will and a clean start.' },
  2: { beadName: 'Moonstone', reason: 'Mulank 2 is calibrated with Moonstone for receptivity and balance.' },
  3: { beadName: 'Citrine', reason: 'Mulank 3 is calibrated with Citrine for expression and sunny momentum.' },
  4: { beadName: 'Green Aventurine', reason: 'Mulank 4 is calibrated with Green Aventurine for steady growth.' },
  5: { beadName: 'Tiger Eye', reason: 'Mulank 5 is calibrated with Tiger Eye for focus through change.' },
  6: { beadName: 'Rose Quartz', reason: 'Mulank 6 is calibrated with Rose Quartz for harmony and care.' },
  7: { beadName: 'Amethyst', reason: 'Mulank 7 is calibrated with Amethyst for insight and inner quiet.' },
  8: { beadName: 'Black Tourmaline', reason: 'Mulank 8 is calibrated with Black Tourmaline for structure and protection.' },
  9: { beadName: 'Carnelian', reason: 'Mulank 9 is calibrated with Carnelian for completion and vitality.' },
};

function parseDateParts(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    const err = new Error('Enter date of birth as YYYY-MM-DD.');
    err.status = 400;
    throw err;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    const err = new Error('That date of birth is not valid.');
    err.status = 400;
    throw err;
  }
  if (dt > new Date()) {
    const err = new Error('Date of birth cannot be in the future.');
    err.status = 400;
    throw err;
  }
  return { year, month, day, iso: raw };
}

function reduceToDigit(n) {
  let x = Math.abs(Number(n) || 0);
  if (x === 0) return 1;
  while (x > 9) {
    x = String(x)
      .split('')
      .reduce((sum, d) => sum + Number(d), 0);
  }
  return x;
}

function mulankFromDate(iso) {
  return reduceToDigit(parseDateParts(iso).day);
}

function bhagyankFromDate(iso) {
  const { year, month, day } = parseDateParts(iso);
  const digits = `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`;
  const sum = digits.split('').reduce((s, d) => s + Number(d), 0);
  return reduceToDigit(sum);
}

function inZodiacRange({ month, day }, range) {
  const value = month * 100 + day;
  const from = range.fromMonth * 100 + range.fromDay;
  const to = range.toMonth * 100 + range.toDay;
  if (from <= to) return value >= from && value <= to;
  return value >= from || value <= to;
}

function zodiacFromDate(iso, ranges = ZODIAC_FALLBACK) {
  const parts = parseDateParts(iso);
  const found = ranges.find((r) => inZodiacRange(parts, r));
  return found || ranges.find((r) => r.slug === 'capricorn');
}

function dateRangeLabel(range) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[range.fromMonth - 1]} ${range.fromDay} – ${months[range.toMonth - 1]} ${range.toDay}`;
}

module.exports = {
  ZODIAC_FALLBACK,
  MULANK_FALLBACK,
  parseDateParts,
  reduceToDigit,
  mulankFromDate,
  bhagyankFromDate,
  zodiacFromDate,
  dateRangeLabel,
};
