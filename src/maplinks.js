// Links that open Apple Maps or Google Maps (the app on phones, the website
// elsewhere). They need no API key, so they work even when OpenStreetMap
// data can't be loaded.

const pt = (p) => `${p.lat},${p.lon}`;

export function appleSearchUrl(query, near) {
  const params = new URLSearchParams({ q: query });
  if (near) {
    params.set("sll", pt(near));
    params.set("z", "15");
  } else params.set("q", `${query} near me`);
  return `https://maps.apple.com/?${params}`;
}

export function googleSearchUrl(query, near) {
  const q = encodeURIComponent(near ? query : `${query} near me`).replace(/%20/g, "+");
  return `https://www.google.com/maps/search/${q}${near ? `/@${pt(near)},15z` : ""}`;
}

export function appleWalkUrl(to, from = null) {
  const params = new URLSearchParams({ daddr: pt(to), dirflg: "w" });
  if (from) params.set("saddr", pt(from));
  return `https://maps.apple.com/?${params}`;
}

export function googleWalkUrl(to, from = null) {
  const params = new URLSearchParams({ api: "1", destination: pt(to), travelmode: "walking" });
  if (from) params.set("origin", pt(from));
  return `https://www.google.com/maps/dir/?${params}`;
}
