# Happy Hour Finder 🍺

A simple, phone-friendly list of pubs and bars within **2 km** of you, with their **happy hour times, menus and prices**. It also has buttons that open **Apple Maps** or **Google Maps**.

Live at **https://chrisholt.github.io/Unfinished/**

## Run it locally

```bash
npm start          # http://localhost:8080
npm test           # unit tests (Node 18+)
```

No dependencies or API keys. It's a static site, published with GitHub Pages from the `gh-pages` branch. To update the live site, push `main` to `gh-pages`. The empty `.nojekyll` file turns off Pages' Jekyll processing. Tests run on every push and pull request (`.github/workflows/test.yml`). Opening `index.html` straight from disk won't work, because browsers block ES modules on `file://`.

## Features

- **Choose a location**: tap *Use my location*, or search for a suburb or street. The app remembers your last location.
- **Venue list**: every pub, bar and beer garden within 2 km, nearest first. Each entry shows:
  - the venue type, distance and address;
  - live happy-hour status, such as *On now · ends 18:30* or *Starts 17:00 · in 40 min*;
  - the happy-hour times;
  - the menu, with each item's happy-hour price next to its usual price.
- **Filter and sort**: show *On now* or *Today* only, sort by distance, soonest happy hour or cheapest drink, or filter by name. Use **When** to check another day or time.
- **Apple Maps / Google Maps**: search for happy hours near you in either app, or get walking directions to any venue. These buttons work even when the venue list can't load.
- **Correct the details**: if you know a venue's real times or prices, use *Correct these details* to save them on your device. Your corrections replace the estimates.

## Where the data comes from

| Data | Source |
|---|---|
| Venue names, addresses, websites, phone numbers | [OpenStreetMap](https://www.openstreetmap.org) via the Overpass API (with backup servers) |
| Place search, and the suburb/currency for your location | OpenStreetMap Nominatim |
| Happy-hour times | The venue's OpenStreetMap `happy_hours` tag if it has one (badge **Listed on OpenStreetMap**); otherwise an **Estimate** |
| Menus and prices | **Estimate**, unless you've saved the real ones (**Your info**) |

**About the estimates:** no public dataset publishes happy-hour menus and prices. Where real data isn't available, the app shows a typical schedule and menu for that kind of venue (pub, cocktail bar, beer garden and so on). These are based on the venue's OpenStreetMap tags (for example, the beers it lists on tap) and priced for the local currency. Every estimate is labelled in the app. Check with the venue before you go.

## Project layout

```
index.html        page
styles.css        styles (single column, phone-first)
src/app.js        UI and event handling
src/api.js        Overpass + Nominatim clients (backup servers, retries, caching)
src/hours.js      happy-hour schedule parser and evaluator
src/menu.js       currencies, estimated schedules/menus, menu text format
src/venues.js     merges OSM data, your corrections and estimates
src/maplinks.js   Apple Maps / Google Maps links
src/store.js      saved corrections (localStorage)
src/geo.js        distance helpers
tests/            unit tests (node --test)
```
