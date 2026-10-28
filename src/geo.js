// Distance and walking-time helpers.

export const SEARCH_RADIUS_M = 2000;

// Straight-line distances underestimate real street routes; this factor is a
// common rule of thumb for dense urban grids.
const DETOUR_FACTOR = 1.3;
const WALK_SPEED_M_PER_MIN = 80; // ~4.8 km/h

export function haversine(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function walkingMetres(a, b) {
  return haversine(a, b) * DETOUR_FACTOR;
}

export function walkingMinutes(a, b) {
  return Math.max(1, Math.round(walkingMetres(a, b) / WALK_SPEED_M_PER_MIN));
}

export function formatDistance(m) {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
}
