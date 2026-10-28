// Parser and evaluator for happy-hour schedules written in the OpenStreetMap
// opening_hours style, e.g. "Mo-Fr 16:00-18:30; Sa 14:00-17:00".
// Supports day ranges/lists, multiple time ranges, ranges past midnight and
// "off". Anything it does not understand is skipped rather than guessed.

const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
export const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function parseDays(spec) {
  const days = new Set();
  for (const part of spec.split(",")) {
    const m = part.trim().match(/^(Mo|Tu|We|Th|Fr|Sa|Su)(?:-(Mo|Tu|We|Th|Fr|Sa|Su))?$/);
    if (!m) return null;
    const from = DAYS.indexOf(m[1]);
    const to = m[2] ? DAYS.indexOf(m[2]) : from;
    for (let i = from; ; i = (i + 1) % 7) {
      days.add(i);
      if (i === to) break;
    }
  }
  return days;
}

function parseTime(t) {
  const m = typeof t === "string" && t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const mins = Number(m[1]) * 60 + Number(m[2]);
  return mins <= 24 * 60 ? mins : null;
}

// Returns [{ days: Set<0..6 (Mon..Sun)>, start, end }] with minutes since
// midnight; end may exceed 1440 for ranges that run past midnight.
export function parseSchedule(text) {
  if (!text) return [];
  const rules = [];
  for (const raw of text.split(/[;|]/)) {
    const rule = raw.trim();
    if (!rule) continue;
    const m = rule.match(/^([A-Za-z,\- ]*?)\s*((?:\d{1,2}:\d{2}-\d{1,2}:\d{2}\s*,?\s*)+|off)$/);
    if (!m) continue;
    const daySpec = m[1].replace(/\s+/g, "");
    const days = daySpec ? parseDays(daySpec) : new Set([0, 1, 2, 3, 4, 5, 6]);
    if (!days) continue;
    if (m[2] === "off") {
      // A later "off" rule overrides earlier rules for those days.
      for (const r of rules) for (const d of days) r.days.delete(d);
      continue;
    }
    for (const range of m[2].split(",")) {
      const [a, b] = range.trim().split("-");
      const start = parseTime(a);
      let end = parseTime(b);
      if (start == null || end == null) continue;
      if (end <= start) end += 24 * 60;
      rules.push({ days: new Set(days), start, end });
    }
  }
  return rules.filter((r) => r.days.size > 0);
}

const dayIndex = (date) => (date.getDay() + 6) % 7;
const minutesOf = (date) => date.getHours() * 60 + date.getMinutes();

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Concrete [start, end] Date intervals overlapping the window [from, to].
export function intervalsBetween(rules, from, to) {
  const out = [];
  const day0 = startOfDay(from);
  day0.setDate(day0.getDate() - 1); // catch ranges that began yesterday
  for (let d = new Date(day0); d <= to; d.setDate(d.getDate() + 1)) {
    const idx = dayIndex(d);
    for (const r of rules) {
      if (!r.days.has(idx)) continue;
      const s = new Date(d);
      s.setMinutes(r.start);
      const e = new Date(d);
      e.setMinutes(r.end);
      if (e > from && s < to) out.push([s, e]);
    }
  }
  return out.sort((x, y) => x[0] - y[0]);
}

// { active, endsAt?, nextStart?, nextEnd? } relative to `now`.
export function statusAt(rules, now) {
  const week = new Date(now.getTime() + 8 * 24 * 3600 * 1000);
  const intervals = intervalsBetween(rules, now, week);
  const current = intervals.find(([s, e]) => s <= now && now < e);
  if (current) return { active: true, endsAt: current[1] };
  const next = intervals.find(([s]) => s > now);
  return next ? { active: false, nextStart: next[0], nextEnd: next[1] } : { active: false };
}

// Minutes of [from, to] that fall inside happy hour.
export function overlapMinutes(rules, from, to) {
  let total = 0;
  for (const [s, e] of intervalsBetween(rules, from, to)) {
    const a = Math.max(s.getTime(), from.getTime());
    const b = Math.min(e.getTime(), to.getTime());
    if (b > a) total += (b - a) / 60000;
  }
  return Math.round(total);
}

export function formatClock(mins) {
  const m = ((mins % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

// Human-readable lines, e.g. ["Mon–Fri 16:00–18:30", "Sat 14:00–17:00"].
export function describeSchedule(rules) {
  return rules.map((r) => {
    const days = [...r.days].sort((a, b) => a - b);
    const groups = [];
    for (const d of days) {
      const g = groups[groups.length - 1];
      if (g && g[1] === d - 1) g[1] = d;
      else groups.push([d, d]);
    }
    const dayText =
      days.length === 7
        ? "Daily"
        : groups
            .map(([a, b]) => (a === b ? DAY_NAMES[a] : `${DAY_NAMES[a]}–${DAY_NAMES[b]}`))
            .join(", ");
    return `${dayText} ${formatClock(r.start)}–${formatClock(r.end)}`;
  });
}

export function minutesUntil(date, now) {
  return Math.round((date - now) / 60000);
}

export function formatDuration(mins) {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h >= 24) return `${Math.round(h / 24)} day${h >= 36 ? "s" : ""}`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export { dayIndex, minutesOf };
