# Happy Hour Finder 🍺

Real happy hours, menus and prices within **2 km** of 247 Oswego St, James Bay, Victoria BC. It also has buttons that open **Apple Maps** or **Google Maps**.

Live at **https://chrisholt.github.io/Unfinished/**

## Run it locally

```bash
npm start          # http://localhost:8080
npm test           # unit tests (Node 18+)
```

No dependencies, API keys or external data services: the venue data ships with the page. It's published with GitHub Pages from the `gh-pages` branch; to update the live site, push `main` to `gh-pages`. Tests run on every push and pull request (`.github/workflows/test.yml`).

## Features

- **16 venues** in James Bay, the Inner Harbour and downtown, nearest first. Each shows:
  - the venue type, approximate distance and address;
  - live status, such as *On now · ends 5 pm* or *Starts 3 pm · in 40 min*;
  - the happy-hour times;
  - the happy-hour menu items and prices that are published online;
  - a note where sources disagree;
  - links to its sources.
- **Filter and sort**: show *On now* or *Today* only, sort by distance or soonest happy hour, and use **When** to check another day or time.
- **Use my location**: measures distances from where you are instead of Oswego St. Outside the researched area, the app points you to the Apple Maps and Google Maps search buttons.
- **Apple Maps / Google Maps**: search for more happy hours nearby, or get walking directions to any venue by its address.

## Where the data comes from

All happy-hour details are in [`src/data/victoria.js`](src/data/victoria.js). They were researched by web search on **28 October 2026**, and each venue lists its sources: Victoria Happy Hour, YAM Magazine, Victoria Buzz, Buy BC, Tasting Victoria, Daily Hive, OpenTable, and venues' own pages. The data only includes prices a source published. Where a venue's prices aren't online, the app says so instead of guessing. Deals change, so check with the venue before you go, and refresh the data now and then.

To update a venue, edit its entry in `src/data/victoria.js`. `schedule` uses the opening-hours style (`Mo-Fr 15:00-17:00; Su-Th 21:00-24:00`), and `hoursText` is what's shown on screen.

## Project layout

```
index.html            page
styles.css            styles (single column, phone-first)
src/app.js            UI
src/data/victoria.js  researched venues, happy hours and prices
src/hours.js          happy-hour schedule parser and "on now" logic
src/maplinks.js       Apple Maps / Google Maps links
src/geo.js            distance helpers
tests/                unit tests (node --test)
```
