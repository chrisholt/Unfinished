import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSchedule, statusAt, overlapMinutes, describeSchedule } from "../src/hours.js";
import { haversine } from "../src/geo.js";
import { estimateMenu, estimateSchedule, currencyFor, textToMenu, menuToText } from "../src/menu.js";
import { enrichVenue } from "../src/venues.js";
import { normaliseElement } from "../src/api.js";

// 2026-10-28 is a Wednesday.
const at = (h, m = 0, day = 28) => new Date(2026, 9, day, h, m);

test("parses day ranges, lists, multiple times and off", () => {
  const rules = parseSchedule("Mo-Fr 16:00-18:00,21:00-22:00; Sa,Su 14:00-17:00; Fr off");
  assert.deepEqual(describeSchedule(rules), ["Mon–Thu 16:00–18:00", "Mon–Thu 21:00–22:00", "Sat–Sun 14:00–17:00"]);
  assert.deepEqual(describeSchedule(parseSchedule("17:00-19:00")), ["Daily 17:00–19:00"]);
  assert.deepEqual(parseSchedule("rubbish"), []);
  assert.deepEqual(parseSchedule("Mo-Fr 16:00-"), []);
});

test("status: active, upcoming, and past-midnight ranges", () => {
  const rules = parseSchedule("Mo-Fr 16:00-18:00");
  assert.equal(statusAt(rules, at(17)).active, true);
  assert.equal(statusAt(rules, at(17)).endsAt.getHours(), 18);
  const later = statusAt(rules, at(12));
  assert.equal(later.active, false);
  assert.equal(later.nextStart.getHours(), 16);
  // Saturday → next is Monday
  assert.equal(statusAt(rules, at(12, 0, 31)).nextStart.getDate(), 2);

  const late = parseSchedule("We 22:00-01:00");
  assert.equal(statusAt(late, at(0, 30, 29)).active, true); // Thu 00:30
  assert.equal(overlapMinutes(late, at(23), at(23, 59, 28)), 59);
});

test("overlap minutes", () => {
  const rules = parseSchedule("Mo-Fr 16:00-18:00");
  assert.equal(overlapMinutes(rules, at(17), at(19)), 60);
  assert.equal(overlapMinutes(rules, at(15), at(16)), 0);
});

test("haversine", () => {
  const d = haversine({ lat: 51.5007, lon: -0.1246 }, { lat: 51.5033, lon: -0.1196 });
  assert.ok(d > 400 && d < 500, String(d));
});

test("estimates are deterministic and discounted", () => {
  const venue = { id: "node/1", kind: "pub", tags: { brewery: "Guinness;Carlsberg" } };
  const gbp = currencyFor("gb");
  assert.equal(gbp.code, "GBP");
  const a = estimateMenu(venue, gbp);
  assert.deepEqual(a, estimateMenu(venue, gbp));
  assert.equal(estimateSchedule(venue), estimateSchedule(venue));
  assert.equal(a[0].items[0].name, "Pint of Guinness");
  for (const s of a) for (const i of s.items) assert.ok(i.happy <= i.regular && i.happy > 0);
  assert.deepEqual(textToMenu(menuToText(a)), a);
});

test("prefers OSM happy_hours over estimates", () => {
  const v = enrichVenue({ id: "node/2", kind: "bar", osmHappyHours: "Mo-Su 12:00-13:00", tags: {} }, currencyFor("us"));
  assert.equal(v.scheduleSource, "osm");
  assert.equal(v.scheduleText, "Mo-Su 12:00-13:00");
});

test("normalises Overpass ways via their centre", () => {
  const v = normaliseElement({ type: "way", id: 5, center: { lat: 1, lon: 2 }, tags: { name: "X", amenity: "pub" } }, { lat: 1, lon: 2 });
  assert.equal(v.id, "way/5");
  assert.equal(v.distance, 0);
  assert.equal(normaliseElement({ type: "node", id: 6, lat: 1, lon: 2, tags: {} }, { lat: 1, lon: 2 }), null);
});

test("map app links", async () => {
  const { appleSearchUrl, googleSearchUrl, appleWalkUrl, googleWalkUrl } = await import("../src/maplinks.js");
  const p = { lat: -37.81, lon: 144.96 };
  assert.equal(appleSearchUrl("happy hour", p), "https://maps.apple.com/?q=happy+hour&sll=-37.81%2C144.96&z=15");
  assert.equal(appleSearchUrl("happy hour"), "https://maps.apple.com/?q=happy+hour+near+me");
  assert.equal(googleSearchUrl("happy hour", p), "https://www.google.com/maps/search/happy+hour/@-37.81,144.96,15z");
  assert.equal(googleSearchUrl("happy hour"), "https://www.google.com/maps/search/happy+hour+near+me");
  assert.equal(appleWalkUrl(p, { lat: 1, lon: 2 }), "https://maps.apple.com/?daddr=-37.81%2C144.96&dirflg=w&saddr=1%2C2");
  assert.ok(googleWalkUrl(p).includes("destination=-37.81%2C144.96&travelmode=walking"));
});
