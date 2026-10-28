# Happy Hour Finder 🍺

Find happy hours at pubs and bars within **2 km** of any spot you choose, see their **menus and prices**, and plan a **three-stop pub crawl** timed to catch the deals.

## Run it

```bash
npm start          # http://localhost:8080
npm test           # unit tests (Node 18+)
```

No dependencies or API keys. It's a static site: every push to `main` runs the tests and deploys it to GitHub Pages (`.github/workflows/pages.yml`). One-time setup: in the repo's **Settings → Pages**, set **Source** to **GitHub Actions**. Opening `index.html` straight from disk won't work because browsers block ES modules on `file://`.

## Features

- **Set your location** with *Use my location*, by searching for a place, by clicking the map, or by dragging the pin. Your last location is remembered.
- **Venues within 2 km**: every pub, bar and beer garden mapped on OpenStreetMap, plus restaurants, cafés and clubs that list happy hours there.
- **Live status** for each venue (*On now · ends 18:30*, *Starts 17:00 · in 40 min*), with filters for *On now* / *Today* and sorting by distance, soonest happy hour or cheapest drink. Use **When** to plan for a different day or time.
- **Menu & prices**: drinks and bar snacks, each with its regular price, happy-hour price and discount, in the local currency.
- **3-stop pub crawl**: tries every route through the best-timed nearby venues and picks the one that keeps you inside happy hour longest with the least walking. You get arrival and leave times, walking time and distance for each leg, what to order, an estimated spend per person, the route on the map, a Google Maps walking-directions link and a share button. Add up to 3 of your own picks and the planner fills the gaps or finds the best order. Use *Try another route* to see alternatives.
- **Correct the details**: if you know a venue's real times or prices, edit them in the venue panel. Your corrections are saved in your browser and take priority over everything else.

## Where the data comes from

| Data | Source |
|---|---|
| Venues, addresses, opening hours, websites | [OpenStreetMap](https://www.openstreetmap.org) via the Overpass API |
| Place search and locality/currency | OpenStreetMap Nominatim |
| Happy-hour times | The venue's OSM `happy_hours` tag when it has one (badge **Listed on OpenStreetMap**), otherwise an **Estimate** |
| Menus and prices | **Estimate**, unless you've entered the real ones (**Your info**) |

**About the estimates:** no public dataset publishes happy-hour menus and prices. Where real data isn't available, the app shows a typical schedule and menu for that kind of venue (pub, cocktail bar, beer garden…), shaped by its OSM tags (e.g. beers it lists on tap) and priced for the local currency and price level. Every estimate is clearly labelled in the app. Check with the venue before you go, and save the real details with *Correct these details*.

## Project layout

```
index.html        page shell
styles.css        styles (responsive, mobile-friendly)
src/app.js        UI, map and event handling
src/api.js        Overpass + Nominatim clients (with fallback mirrors and caching)
src/hours.js      opening_hours-style schedule parser and evaluator
src/menu.js       currencies, estimated schedules/menus, menu text format
src/venues.js     merges OSM data, your corrections and estimates
src/crawl.js      pub crawl planner
src/store.js      saved corrections (localStorage)
src/geo.js        distance and walking-time helpers
vendor/leaflet/   Leaflet 1.9.4 map library (BSD-2-Clause)
tests/            unit tests (node --test)
```
