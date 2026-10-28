// User corrections to happy-hour times and menus, kept in this browser.

const KEY = "hhf:overrides:v1";

// In-memory copy so edits still work for this page when storage is blocked.
let memory = null;

function readAll() {
  if (!memory) {
    try {
      memory = JSON.parse(localStorage.getItem(KEY)) || {};
    } catch {
      memory = {};
    }
  }
  return memory;
}

function persist(all) {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Unavailable storage (private mode); edits last for this page only.
  }
}

export function getOverride(venueId) {
  return readAll()[venueId] || null;
}

export function saveOverride(venueId, override) {
  const all = readAll();
  all[venueId] = { ...override, updatedAt: new Date().toISOString() };
  persist(all);
  return all[venueId];
}

export function clearOverride(venueId) {
  const all = readAll();
  delete all[venueId];
  persist(all);
}
