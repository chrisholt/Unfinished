// Three-stop pub crawl planner. Scores every ordered route through the most
// promising venues on how much of each stay lands in happy hour, how far you
// walk, price, and variety.

import { overlapMinutes } from "./hours.js";
import { walkingMetres, walkingMinutes } from "./geo.js";

export const CRAWL_STOPS = 3;
const MAX_CANDIDATES = 24;
const LONG_LEG_MIN = 20;

function cheapestSnack(menu) {
  const items = menu.filter((s) => s.section !== "Drinks").flatMap((s) => s.items);
  return items.reduce((best, i) => (!best || i.happy < best.happy ? i : best), null);
}

// Simulates walking the route in order from `origin` starting at `start`.
export function simulate(order, origin, start, stayMins) {
  let clock = new Date(start);
  let here = origin;
  let totalWalkMin = 0;
  let totalWalkM = 0;
  let cost = 0;
  const stops = order.map((venue, i) => {
    const walkMin = walkingMinutes(here, venue);
    const walkM = walkingMetres(here, venue);
    const arrive = new Date(clock.getTime() + walkMin * 60000);
    const leave = new Date(arrive.getTime() + stayMins * 60000);
    const hhMins = overlapMinutes(venue.rules, arrive, leave);

    // Budget: two drinks per stop (each at happy-hour price only if that
    // part of the stay is in happy hour) plus one snack at the middle stop.
    const drink = venue.cheapest;
    if (drink) {
      cost += hhMins > 0 ? drink.happy : drink.regular;
      cost += hhMins >= stayMins / 2 ? drink.happy : drink.regular;
    }
    const snack = i === 1 ? cheapestSnack(venue.menu) : null;
    if (snack) cost += hhMins > 0 ? snack.happy : snack.regular;

    totalWalkMin += walkMin;
    totalWalkM += walkM;
    clock = leave;
    here = venue;
    return { venue, arrive, leave, walkMin, walkM, hhMins, drink, snack };
  });
  return { stops, totalWalkMin, totalWalkM, finish: clock, cost, stayMins };
}

function score(plan) {
  let s = 0;
  for (const stop of plan.stops) {
    const coverage = stop.hhMins / plan.stayMins;
    s += coverage * 100;
    if (stop.hhMins === 0) s -= 60;
    if (stop.walkMin > LONG_LEG_MIN) s -= (stop.walkMin - LONG_LEG_MIN) * 3;
  }
  s -= plan.totalWalkMin * 1.2;
  s += (new Set(plan.stops.map((x) => x.venue.kind)).size - 1) * 8;
  return s;
}

function permutations(items) {
  if (items.length <= 1) return [items];
  return items.flatMap((x, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [x, ...rest]),
  );
}

// Best order for a fixed set of venues.
export function bestOrder(venues, origin, start, stayMins) {
  let best = null;
  for (const order of permutations(venues)) {
    const plan = simulate(order, origin, start, stayMins);
    plan.score = score(plan);
    if (!best || plan.score > best.score) best = plan;
  }
  return best;
}

// Ranked plans, each visiting a different set of venues. Every plan includes
// all `required` venues (the user's own picks).
export function planCrawls(venues, origin, start, stayMins, { required = [], limit = 10 } = {}) {
  if (venues.length < CRAWL_STOPS) return [];
  if (required.length >= CRAWL_STOPS) return [bestOrder(required.slice(0, CRAWL_STOPS), origin, start, stayMins)];
  const windowEnd = new Date(start.getTime() + (CRAWL_STOPS * (stayMins + 15) + 30) * 60000);
  const ranked = venues
    .map((v) => ({ v, hh: overlapMinutes(v.rules, start, windowEnd) }))
    .sort((a, b) => b.hh - a.hh || a.v.distance - b.v.distance);
  const withHH = ranked.filter((x) => x.hh > 0).slice(0, MAX_CANDIDATES);
  const requiredIds = new Set(required.map((v) => v.id));
  const candidates = [
    ...required,
    ...(withHH.length >= CRAWL_STOPS ? withHH : ranked.slice(0, MAX_CANDIDATES))
      .map((x) => x.v)
      .filter((v) => !requiredIds.has(v.id)),
  ];

  const plans = [];
  const n = candidates.length;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++) {
        const trio = [candidates[a], candidates[b], candidates[c]];
        if (trio.filter((v) => requiredIds.has(v.id)).length < requiredIds.size) continue;
        plans.push(bestOrder(trio, origin, start, stayMins));
      }
  plans.sort((x, y) => y.score - x.score);

  // Keep variety among alternatives: skip plans that reuse two of the same
  // venues as a plan already chosen.
  const chosen = [];
  for (const p of plans) {
    const ids = new Set(p.stops.map((s) => s.venue.id));
    if (chosen.some((c) => c.stops.filter((s) => ids.has(s.venue.id)).length >= 2)) continue;
    chosen.push(p);
    if (chosen.length >= limit) break;
  }
  return chosen;
}

export function directionsUrl(origin, plan) {
  const pts = plan.stops.map((s) => `${s.venue.lat},${s.venue.lon}`);
  const params = new URLSearchParams({
    api: "1",
    origin: `${origin.lat},${origin.lon}`,
    destination: pts[pts.length - 1],
    waypoints: pts.slice(0, -1).join("|"),
    travelmode: "walking",
  });
  return `https://www.google.com/maps/dir/?${params}`;
}
