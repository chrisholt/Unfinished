// Combines OSM venue data, user corrections and estimates into the shape the
// UI and crawl planner use.

import { parseSchedule } from "./hours.js";
import { estimateMenu, estimateSchedule, cheapestDrink } from "./menu.js";
import { getOverride } from "./store.js";

export const SOURCE_LABELS = {
  user: "Your info",
  osm: "Listed on OpenStreetMap",
  estimated: "Estimated",
};

export function enrichVenue(venue, currency) {
  const override = getOverride(venue.id);
  let scheduleText;
  let scheduleSource;
  if (override?.schedule) {
    scheduleText = override.schedule;
    scheduleSource = "user";
  } else if (venue.osmHappyHours && parseSchedule(venue.osmHappyHours).length) {
    scheduleText = venue.osmHappyHours;
    scheduleSource = "osm";
  } else {
    scheduleText = estimateSchedule(venue);
    scheduleSource = "estimated";
  }
  const menu = override?.menu?.length ? override.menu : estimateMenu(venue, currency);
  return {
    ...venue,
    scheduleText,
    scheduleSource,
    rules: parseSchedule(scheduleText),
    menu,
    menuSource: override?.menu?.length ? "user" : "estimated",
    cheapest: cheapestDrink(menu),
  };
}
