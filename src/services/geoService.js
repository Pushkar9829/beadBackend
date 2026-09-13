function fail(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function pick(...values) {
  return values.find((value) => String(value || '').trim()) || '';
}

function mapNominatim(json) {
  const a = json?.address || {};
  const road = [a.house_number, a.road || a.pedestrian || a.residential || a.street].filter(Boolean).join(' ').trim();
  const area = pick(a.neighbourhood, a.suburb, a.quarter, a.city_district, a.county);
  const city = pick(a.city, a.town, a.village, a.municipality, a.state_district, a.county);
  const display = String(json?.display_name || '');
  return {
    line1: road || area || display.split(',')[0] || '',
    line2: road ? area : '',
    city,
    state: pick(a.state),
    pincode: String(a.postcode || '').replace(/\D/g, '').slice(0, 6),
    country: pick(a.country, 'India') || 'India',
    label: 'Current location',
    display,
  };
}

async function reverse(lat, lng) {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    throw fail('A valid latitude and longitude are required.');
  }
  const url = new URL('https://nominatim.openstreetmap.org/reverse');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('lat', String(latitude));
  url.searchParams.set('lon', String(longitude));
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('zoom', '18');
  const res = await fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'KuberstonesStore/1.0 (hello@kuberstones.com)',
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw fail('Could not read this location. Try again or enter the address.', 502);
  const json = await res.json();
  const address = mapNominatim(json);
  if (!address.line1 && !address.city) {
    throw fail('No street address was found for this location. Please enter it manually.');
  }
  return {
    ...address,
    lat: latitude,
    lng: longitude,
    source: 'gps',
  };
}

module.exports = { reverse };
