// OpenStreetMap data: venues from the Overpass API, place search and
// reverse geocoding from Nominatim. Both are free, keyless services; keep
// request volume low (results are cached per session).

import { SEARCH_RADIUS_M, haversine } from "./geo.js";

// Public Overpass servers, tried in order. They are free and often busy, so
// a failure on one moves on to the next.
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const OVERPASS_TIMEOUT_MS = 45000;
const NOMINATIM = "https://nominatim.openstreetmap.org";

function cacheGet(key) {
  try {
    const v = sessionStorage.getItem(key);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}

function cacheSet(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or unavailable; caching is only an optimisation.
  }
}

async function fetchJson(url, options = {}, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
    return await res.json();
  } catch (err) {
    if (err.name === "AbortError") throw Object.assign(new Error("timed out"), { timeout: true });
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function overpassQuery({ lat, lon }, radius) {
  const around = `(around:${radius},${lat.toFixed(5)},${lon.toFixed(5)})`;
  return `[out:json][timeout:40];
(
  nwr["amenity"~"^(pub|bar|biergarten)$"]["name"]${around};
  nwr["happy_hours"]["amenity"~"^(nightclub|restaurant|cafe)$"]["name"]${around};
);
out center tags;`;
}

function formatAddress(t) {
  const street = [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ");
  return [street, t["addr:suburb"] || t["addr:city"]].filter(Boolean).join(", ");
}

export function normaliseElement(el, origin) {
  const t = el.tags || {};
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat == null || lon == null || !t.name) return null;
  return {
    id: `${el.type}/${el.id}`,
    name: t.name,
    kind: t.amenity,
    lat,
    lon,
    distance: haversine(origin, { lat, lon }),
    tags: t,
    address: formatAddress(t),
    website: t.website || t["contact:website"] || null,
    phone: t.phone || t["contact:phone"] || null,
    openingHours: t.opening_hours || null,
    osmHappyHours: t.happy_hours || null,
  };
}

// `onProgress(attempt, total)` is called before each server is tried.
export async function fetchVenues(origin, { radius = SEARCH_RADIUS_M, onProgress = () => {} } = {}) {
  const key = `venues:${origin.lat.toFixed(4)},${origin.lon.toFixed(4)},${radius}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const body = "data=" + encodeURIComponent(overpassQuery(origin, radius));
  const request = (endpoint) =>
    fetchJson(
      endpoint,
      { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body },
      OVERPASS_TIMEOUT_MS,
    );
  const errors = [];
  for (const [i, endpoint] of OVERPASS_ENDPOINTS.entries()) {
    onProgress(i + 1, OVERPASS_ENDPOINTS.length);
    try {
      let data;
      try {
        data = await request(endpoint);
      } catch (err) {
        // "Too many requests" / "gateway timeout" usually clear within seconds.
        if (err.status !== 429 && err.status !== 504) throw err;
        await new Promise((r) => setTimeout(r, 3000));
        data = await request(endpoint);
      }
      const seen = new Set();
      const venues = (data.elements || [])
        .map((el) => normaliseElement(el, origin))
        .filter((v) => v && v.distance <= radius && !seen.has(v.id) && seen.add(v.id))
        .sort((a, b) => a.distance - b.distance);
      cacheSet(key, venues);
      return venues;
    } catch (err) {
      errors.push(err);
    }
  }
  const reason = errors.every((e) => e.timeout || e.status === 429 || e.status === 504)
    ? "the servers are busy right now — wait a minute and retry"
    : errors.every((e) => !e.status && !e.timeout)
      ? "check your internet connection, or turn off any ad or content blocker for this site"
      : errors.map((e) => e.message).join(", ");
  throw new Error(`Couldn't load venues from OpenStreetMap: ${reason}.`);
}

export async function searchPlaces(query) {
  const url = `${NOMINATIM}/search?format=jsonv2&limit=5&addressdetails=1&q=${encodeURIComponent(query)}`;
  const results = await fetchJson(url, { headers: { Accept: "application/json" } }, 15000);
  return results.map((r) => ({
    label: r.display_name,
    lat: Number(r.lat),
    lon: Number(r.lon),
    countryCode: r.address?.country_code || null,
  }));
}

export async function reverseGeocode({ lat, lon }) {
  const key = `rev:${lat.toFixed(3)},${lon.toFixed(3)}`;
  const cached = cacheGet(key);
  if (cached) return cached;
  const url = `${NOMINATIM}/reverse?format=jsonv2&zoom=16&addressdetails=1&lat=${lat}&lon=${lon}`;
  const r = await fetchJson(url, { headers: { Accept: "application/json" } }, 15000);
  const a = r.address || {};
  const place = {
    label: [a.road, a.suburb || a.neighbourhood, a.city || a.town || a.village].filter(Boolean).join(", ") || r.display_name,
    countryCode: a.country_code || null,
  };
  cacheSet(key, place);
  return place;
}
