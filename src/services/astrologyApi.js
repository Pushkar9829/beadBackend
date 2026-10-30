// AstrologyAPI (astrologyapi.com) client. Server-side only: the API has no CORS and the key is secret.
// Credentials come from ASTROLOGY_API_USER_ID / ASTROLOGY_API_KEY (Render env), never from code or the DB.
// Mock mode (ASTROLOGY_API_MOCK=1 only) returns canned responses so local runs and tests never spend
// credits. It is opt-in so a live server without a key reports "not configured" instead of handing real
// customers a fake Kundli.

const JSON_BASE = 'https://json.astrologyapi.com/v1';
const PDF_URL = 'https://pdf.astrologyapi.com/v1/basic_horoscope_pdf';

function fail(message, status = 502, code = 'upstream') {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

function timeoutMs() {
  return Number(process.env.ASTROLOGY_API_TIMEOUT_MS) || 20000;
}

function credentials() {
  return {
    userId: String(process.env.ASTROLOGY_API_USER_ID || '').trim(),
    apiKey: String(process.env.ASTROLOGY_API_KEY || '').trim(),
  };
}

function isMock() {
  const flag = String(process.env.ASTROLOGY_API_MOCK || '').trim().toLowerCase();
  return flag === '1' || flag === 'true';
}

function isConfigured() {
  return isMock() || Boolean(credentials().apiKey);
}

function headers(extra = {}) {
  const { userId, apiKey } = credentials();
  const out = { Accept: 'application/json', 'Accept-Language': 'en', ...extra };
  // Most endpoint docs use Basic auth; some show the x-astrologyapi-key header. Send both.
  if (userId) out.Authorization = `Basic ${Buffer.from(`${userId}:${apiKey}`).toString('base64')}`;
  out['x-astrologyapi-key'] = apiKey;
  return out;
}

function statusError(status, endpoint) {
  if (status === 401 || status === 403) return fail(`AstrologyAPI rejected the credentials (${status}) on ${endpoint}.`, 502, 'auth');
  if (status === 402) return fail('AstrologyAPI: the account is out of credits (402).', 502, 'credits');
  if (status === 429) return fail(`AstrologyAPI rate limit reached on ${endpoint}.`, 502, 'rate');
  if (status >= 500) return fail(`AstrologyAPI is unavailable (${status}) on ${endpoint}.`, 502, 'upstream');
  return fail(`AstrologyAPI returned ${status} on ${endpoint}.`, 502, 'upstream');
}

async function send(url, endpoint, init) {
  let res;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs()) });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') throw fail(`AstrologyAPI timed out on ${endpoint}.`, 504, 'timeout');
    throw fail(`Could not reach AstrologyAPI (${endpoint}): ${err.message}`, 502, 'network');
  }
  const text = await res.text();
  if (!res.ok) throw statusError(res.status, endpoint);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    // horo_chart_image can come back as a bare SVG string.
    if (/^\s*<svg[\s>]/i.test(text)) return text;
    throw fail(`AstrologyAPI sent an unreadable response on ${endpoint}.`, 502, 'upstream');
  }
  // Errors are sometimes a 200 with { status: false, msg }.
  if (json && typeof json === 'object' && json.status === false) {
    throw fail(`AstrologyAPI ${endpoint}: ${json.msg || json.message || 'request failed'}.`, 502, 'upstream');
  }
  return json;
}

function assertLive() {
  if (!credentials().apiKey) throw fail('AstrologyAPI is not configured.', 503, 'not_configured');
}

/** POST a JSON endpoint, e.g. call('astro_details', birthBody). */
async function call(endpoint, body) {
  if (isMock()) return mockResponse(endpoint, body);
  assertLive();
  return send(`${JSON_BASE}/${endpoint}`, endpoint, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body || {}),
  });
}

/** Basic horoscope PDF; resolves to the hosted pdf_url. */
async function horoscopePdf(fields) {
  if (isMock()) return mockResponse('pdf', fields).pdf_url;
  assertLive();
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(fields || {})) if (v !== undefined && v !== null) form.set(k, String(v));
  const json = await send(PDF_URL, 'basic_horoscope_pdf', {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/x-www-form-urlencoded' }),
    body: form.toString(),
  });
  if (!json?.pdf_url) throw fail('AstrologyAPI did not return a PDF link.', 502, 'upstream');
  return json.pdf_url;
}

/* ---------------- mock mode ---------------- */

// ASTROLOGY_API_MOCK_FAIL (mock mode only): comma list of endpoints that should fail, e.g.
// "planets,pdf", or "all". Used to exercise partial/failed runs in local tests.
function mockShouldFail(endpoint) {
  const list = String(process.env.ASTROLOGY_API_MOCK_FAIL || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const key = String(endpoint).toLowerCase();
  return list.includes('all') || list.includes(key) || list.includes(key.split('/')[0]);
}

const MOCK_PLACES = [
  ['Varanasi', 25.3176, 82.9739, 'Asia/Kolkata', 'IN'],
  ['Vadodara', 22.3072, 73.1812, 'Asia/Kolkata', 'IN'],
  ['Rishikesh', 30.0869, 78.2676, 'Asia/Kolkata', 'IN'],
  ['New Delhi', 28.6139, 77.209, 'Asia/Kolkata', 'IN'],
  ['Mumbai', 19.076, 72.8777, 'Asia/Kolkata', 'IN'],
  ['Jaipur', 26.9124, 75.7873, 'Asia/Kolkata', 'IN'],
  ['Kathmandu', 27.7172, 85.324, 'Asia/Kathmandu', 'NP'],
  ['London', 51.5072, -0.1276, 'Europe/London', 'GB'],
  ['New York', 40.7128, -74.006, 'America/New_York', 'US'],
];

const MOCK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 350 350" width="350" height="350">' +
  '<rect x="1" y="1" width="348" height="348" fill="#fff8e7" stroke="#b8860b" stroke-width="2"/>' +
  '<path d="M1 1 L349 349 M349 1 L1 349 M175 1 L1 175 L175 349 L349 175 Z" fill="none" stroke="#b8860b" stroke-width="1.5"/>' +
  '<text x="175" y="95" font-size="14" text-anchor="middle" fill="#7a1f1f">1 Asc</text>' +
  '<text x="175" y="115" font-size="12" text-anchor="middle" fill="#333">Su Me</text>' +
  '<text x="88" y="50" font-size="12" text-anchor="middle" fill="#333">2</text>' +
  '<text x="50" y="88" font-size="12" text-anchor="middle" fill="#333">3 Ma</text>' +
  '<text x="88" y="180" font-size="12" text-anchor="middle" fill="#333">4 Mo</text>' +
  '<text x="50" y="265" font-size="12" text-anchor="middle" fill="#333">5</text>' +
  '<text x="88" y="305" font-size="12" text-anchor="middle" fill="#333">6 Ra</text>' +
  '<text x="175" y="260" font-size="12" text-anchor="middle" fill="#333">7 Ju</text>' +
  '<text x="262" y="305" font-size="12" text-anchor="middle" fill="#333">8</text>' +
  '<text x="300" y="265" font-size="12" text-anchor="middle" fill="#333">9 Sa</text>' +
  '<text x="262" y="180" font-size="12" text-anchor="middle" fill="#333">10 Ve</text>' +
  '<text x="300" y="88" font-size="12" text-anchor="middle" fill="#333">11</text>' +
  '<text x="262" y="50" font-size="12" text-anchor="middle" fill="#333">12 Ke</text>' +
  '</svg>';

function mockPlanets() {
  const rows = [
    ['Sun', 'Leo', 1, 132.41, false],
    ['Moon', 'Scorpio', 4, 221.08, false],
    ['Mars', 'Gemini', 11, 75.62, false],
    ['Mercury', 'Leo', 1, 140.17, true],
    ['Jupiter', 'Aquarius', 7, 304.9, true],
    ['Venus', 'Taurus', 10, 48.33, false],
    ['Saturn', 'Aries', 9, 12.75, false],
    ['Rahu', 'Capricorn', 6, 281.4, true],
    ['Ketu', 'Cancer', 12, 101.4, true],
    ['Ascendant', 'Leo', 1, 128.2, false],
  ];
  return rows.map(([name, sign, house, fullDegree, isRetro], id) => ({
    id,
    name,
    fullDegree,
    normDegree: Math.round((fullDegree % 30) * 100) / 100,
    speed: 0.98,
    isRetro: String(isRetro),
    sign,
    signLord: 'Sun',
    nakshatra: 'Magha',
    nakshatraLord: 'Ketu',
    nakshatra_pad: 2,
    house,
    is_planet_set: false,
    planet_awastha: 'Yuva',
  }));
}

function mockResponse(endpoint, body = {}) {
  if (mockShouldFail(endpoint)) throw fail(`AstrologyAPI mock failure on ${endpoint}.`, 502, 'upstream');
  switch (endpoint) {
    case 'astro_details':
      return {
        ascendant: 'Leo',
        ascendant_lord: 'Sun',
        Varna: 'Brahmin',
        Vashya: 'Keet',
        Yoni: 'Mriga',
        Gan: 'Rakshasa',
        Nadi: 'Antya',
        SignLord: 'Mars',
        sign: 'Scorpio',
        Naksahtra: 'Anuradha',
        NaksahtraLord: 'Saturn',
        Charan: 3,
        Yog: 'Siddhi',
        Karan: 'Bava',
        Tithi: 'Shukla Panchami',
        yunja: 'Madhya',
        tatva: 'Water',
        name_alphabet: 'Nu',
        paya: 'Copper',
      };
    case 'planets':
      return mockPlanets();
    case 'horo_chart_image/D1':
      return { svg: MOCK_SVG };
    case 'current_vdasha':
      return {
        major: { planet: 'Saturn', start: '14-3-2019 6:32', end: '14-3-2038 12:44' },
        minor: { planet: 'Mercury', start: '17-3-2022 1:10', end: '25-11-2024 3:41' },
        sub_minor: { planet: 'Venus', start: '9-9-2024 12:00', end: '25-11-2024 3:41' },
        sub_sub_minor: { planet: 'Moon', start: '1-11-2024 0:00', end: '25-11-2024 3:41' },
        sub_sub_sub_minor: { planet: 'Mars', start: '20-11-2024 0:00', end: '25-11-2024 3:41' },
      };
    case 'manglik':
      return {
        manglik_present_rule: { based_on_aspect: [], based_on_house: ['Mars is in eleventh house'] },
        manglik_cancel_rule: [],
        is_mars_manglik_cancelled: false,
        manglik_status: 'NOT MANGLIK',
        percentage_manglik_present: 12.5,
        percentage_manglik_after_cancellation: 0,
        manglik_report: 'Mars is not placed in a manglik house in this chart, so the native is not manglik.',
        is_present: false,
      };
    case 'basic_gem_suggestion':
      return {
        LIFE: { name: 'Ruby', gem_key: 'ruby', semi_gem: 'Garnet', wear_finger: 'Ring Finger', weight_caret: '3-6', wear_metal: 'Gold, Copper', wear_day: 'Sunday', gem_deity: 'Sun' },
        BENEFIC: { name: 'Red Coral', gem_key: 'red_coral', semi_gem: 'Carnelian', wear_finger: 'Ring Finger', weight_caret: '6-9', wear_metal: 'Gold, Copper', wear_day: 'Tuesday', gem_deity: 'Mars' },
        LUCKY: { name: 'Yellow Sapphire', gem_key: 'yellow_sapphire', semi_gem: 'Citrine', wear_finger: 'Index Finger', weight_caret: '3-5', wear_metal: 'Gold', wear_day: 'Thursday', gem_deity: 'Jupiter' },
      };
    case 'rudraksha_suggestion':
      return {
        img_url: '',
        rudraksha_key: 'five_mukhi',
        name: 'Five Faced',
        recommend: 'Five Mukhi Rudraksha is recommended for you.',
        detail: 'Ruled by Jupiter, the five-faced Rudraksha brings calm, clarity and good health.',
      };
    case 'geo_details': {
      const q = String(body.place || '').trim().toLowerCase();
      const max = Number(body.maxRows) || 6;
      const geonames = MOCK_PLACES.filter(([name]) => name.toLowerCase().startsWith(q) || name.toLowerCase().includes(q))
        .slice(0, max)
        .map(([place_name, latitude, longitude, timezone_id, country_code]) => ({
          place_name,
          latitude: String(latitude),
          longitude: String(longitude),
          timezone_id,
          country_code,
        }));
      return { geonames };
    }
    case 'pdf':
      return { status: true, pdf_url: `https://pdf.astrologyapi.com/mock/kundli-${Date.now().toString(36)}.pdf` };
    default:
      throw fail(`AstrologyAPI mock has no response for ${endpoint}.`, 502, 'upstream');
  }
}

module.exports = { call, horoscopePdf, isMock, isConfigured };
