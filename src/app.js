import { SEARCH_RADIUS_M, formatDistance } from "./geo.js";
import { statusAt, describeSchedule, minutesUntil, formatDuration, parseSchedule, formatClock, minutesOf } from "./hours.js";
import { currencyFor, formatPrice, menuToText, textToMenu } from "./menu.js";
import { fetchVenues, searchPlaces, reverseGeocode } from "./api.js";
import { enrichVenue, SOURCE_LABELS } from "./venues.js";
import { planCrawls, bestOrder, directionsUrl, CRAWL_STOPS } from "./crawl.js";
import { saveOverride, clearOverride } from "./store.js";
import { appleSearchUrl, googleSearchUrl, appleWalkUrl, googleWalkUrl } from "./maplinks.js";

const L = window.L;
const $ = (sel) => document.querySelector(sel);
const LOCATION_KEY = "hhf:location:v1";

const KIND_LABELS = {
  pub: "Pub", bar: "Bar", biergarten: "Beer garden", nightclub: "Club", restaurant: "Restaurant", cafe: "Café",
};

const state = {
  origin: null, // { lat, lon, label, countryCode }
  currency: currencyFor(localeCountry()),
  rawVenues: [],
  venues: [],
  filter: "all",
  sort: "distance",
  nameFilter: "",
  when: null, // null = live "now"
  picks: [], // venue ids chosen for the crawl
  plans: [],
  planIndex: 0,
  loadId: 0,
};

function localeCountry() {
  const m = (navigator.language || "").match(/-([A-Za-z]{2})$/);
  return m ? m[1].toLowerCase() : "us";
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function safeUrl(url) {
  if (!url) return null;
  const u = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  try {
    const parsed = new URL(u);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

const now = () => state.when || new Date();
const price = (v) => formatPrice(v, state.currency);
const clock = (d) => formatClock(minutesOf(d));

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.hidden = true), 3500);
}

// ---------- Map ----------

const map = L.map("map", { zoomControl: true }).setView([20, 0], 2);
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: OSM_ATTRIBUTION,
}).addTo(map);

// If OpenStreetMap's own tile server won't load (blocked or overloaded),
// switch once to CARTO's copy of the same map.
let tilesLoaded = 0;
let tileErrors = 0;
tiles.on("tileload", () => tilesLoaded++);
tiles.on("tileerror", () => {
  if (++tileErrors === 4 && tilesLoaded === 0) {
    map.attributionControl.removeAttribution(OSM_ATTRIBUTION);
    map.attributionControl.addAttribution(`${OSM_ATTRIBUTION} &copy; <a href="https://carto.com/attributions">CARTO</a>`);
    tiles.setUrl("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png");
  }
});

const venueLayer = L.layerGroup().addTo(map);
const crawlLayer = L.layerGroup().addTo(map);
let originMarker = null;
let radiusCircle = null;
const markers = new Map();

// Keep tiles aligned when the layout changes size (rotation, mobile layout).
new ResizeObserver(() => map.invalidateSize()).observe(document.getElementById("map"));

map.on("click", (e) => setLocation({ lat: e.latlng.lat, lon: e.latlng.lng }));

function drawOrigin() {
  const { lat, lon } = state.origin;
  if (!originMarker) {
    originMarker = L.marker([lat, lon], { draggable: true, title: "Search centre — drag to move" }).addTo(map);
    originMarker.on("dragend", () => {
      const p = originMarker.getLatLng();
      setLocation({ lat: p.lat, lon: p.lng });
    });
    radiusCircle = L.circle([lat, lon], {
      radius: SEARCH_RADIUS_M, color: "#f5a524", weight: 1.5, fillOpacity: 0.05, interactive: false,
    }).addTo(map);
  } else {
    originMarker.setLatLng([lat, lon]);
    radiusCircle.setLatLng([lat, lon]);
  }
  map.fitBounds(radiusCircle.getBounds(), { padding: [10, 10] });
}

function statusClass(v) {
  const st = statusAt(v.rules, now());
  if (st.active) return "live";
  if (st.nextStart && st.nextStart.toDateString() === now().toDateString()) return "later";
  return "off";
}

function drawVenueMarkers() {
  venueLayer.clearLayers();
  markers.clear();
  const colors = { live: "#22c55e", later: "#f5a524", off: "#8b8f98" };
  for (const v of state.venues) {
    const cls = statusClass(v);
    const m = L.circleMarker([v.lat, v.lon], {
      radius: 7, color: "#111", weight: 1, fillColor: colors[cls], fillOpacity: 0.95,
    })
      .bindTooltip(esc(v.name))
      .on("click", () => openVenue(v.id));
    m.addTo(venueLayer);
    markers.set(v.id, m);
  }
}

// ---------- Location ----------

async function setLocation({ lat, lon, label = null, countryCode = null }) {
  state.origin = { lat, lon, label, countryCode };
  state.picks = [];
  state.plans = [];
  try {
    localStorage.setItem(LOCATION_KEY, JSON.stringify(state.origin));
  } catch {
    // Remembering the location is a convenience only.
  }
  drawOrigin();
  crawlLayer.clearLayers();
  renderLocationLine();
  await loadVenues();
}

function renderLocationLine() {
  const o = state.origin;
  const coords = `${o.lat.toFixed(4)}, ${o.lon.toFixed(4)}`;
  $("#location-line").innerHTML = `<strong>Within 2 km of</strong> ${esc(o.label || coords)}
    <span class="muted">· drag the pin or click the map to move</span>`;
  renderMapsLinks();
}

// Hand-off to the phone's map apps, near the pin (or "near me" without one).
function renderMapsLinks() {
  const near = state.origin;
  $("#maps-links").innerHTML = `<span class="muted">Search happy hours in</span>
    <a class="btn btn-small" href="${esc(appleSearchUrl("happy hour", near))}" target="_blank" rel="noopener">Apple Maps</a>
    <a class="btn btn-small" href="${esc(googleSearchUrl("happy hour", near))}" target="_blank" rel="noopener">Google Maps</a>`;
}

async function loadVenues() {
  const id = ++state.loadId;
  setStatus("loading", "Finding pubs and bars within 2 km… this can take up to 30 seconds.");
  $("#venue-list").innerHTML = "";
  venueLayer.clearLayers();

  if (!state.origin.countryCode || !state.origin.label) {
    try {
      const place = await reverseGeocode(state.origin);
      if (id !== state.loadId) return;
      state.origin.label ||= place.label;
      state.origin.countryCode ||= place.countryCode;
      renderLocationLine();
    } catch {
      // Fall back to the browser locale for currency.
    }
  }
  state.currency = currencyFor(state.origin.countryCode || localeCountry());

  try {
    const raw = await fetchVenues(state.origin, {
      onProgress: (attempt, total) => {
        if (attempt > 1 && id === state.loadId) {
          setStatus("loading", `The map data server is busy. Trying backup server ${attempt - 1} of ${total - 1}…`);
        }
      },
    });
    if (id !== state.loadId) return;
    state.rawVenues = raw;
    rebuildVenues();
    if (!raw.length) setStatus("empty", "No pubs or bars are mapped within 2 km here. Try moving the pin closer to a town centre.");
    else setStatus(null);
  } catch (err) {
    if (id !== state.loadId) return;
    setStatus("error", `${err.message} <button class="btn btn-small" id="retry-btn">Retry</button>`);
    $("#retry-btn")?.addEventListener("click", loadVenues);
  }
}

function rebuildVenues() {
  state.venues = state.rawVenues.map((v) => enrichVenue(v, state.currency));
  renderAll();
}

function setStatus(kind, html) {
  const el = $("#status");
  el.hidden = !kind;
  el.className = `status ${kind || ""}`;
  el.innerHTML = kind === "loading" ? `<span class="spinner"></span>${html}` : html || "";
}

// ---------- Venue list ----------

function statusText(v) {
  const t = now();
  const st = statusAt(v.rules, t);
  if (!v.rules.length) return { cls: "off", text: "No happy hour listed" };
  if (st.active) return { cls: "live", text: `On now · ends ${clock(st.endsAt)} (${formatDuration(minutesUntil(st.endsAt, t))} left)` };
  if (!st.nextStart) return { cls: "off", text: "No upcoming happy hour" };
  const mins = minutesUntil(st.nextStart, t);
  const sameDay = st.nextStart.toDateString() === t.toDateString();
  const day = sameDay ? "" : `${st.nextStart.toLocaleDateString(undefined, { weekday: "short" })} `;
  return {
    cls: sameDay ? "later" : "off",
    text: `Starts ${day}${clock(st.nextStart)} · in ${formatDuration(mins)}`,
  };
}

function visibleVenues() {
  const t = now();
  let list = state.venues.filter((v) => v.name.toLowerCase().includes(state.nameFilter));
  if (state.filter === "live") list = list.filter((v) => statusAt(v.rules, t).active);
  if (state.filter === "today") list = list.filter((v) => statusClass(v) !== "off");
  const soonKey = (v) => {
    const st = statusAt(v.rules, t);
    return st.active ? -1 : st.nextStart ? st.nextStart - t : Infinity;
  };
  const sorters = {
    distance: (a, b) => a.distance - b.distance,
    soonest: (a, b) => soonKey(a) - soonKey(b) || a.distance - b.distance,
    cheapest: (a, b) => (a.cheapest?.happy ?? Infinity) - (b.cheapest?.happy ?? Infinity) || a.distance - b.distance,
  };
  return list.sort(sorters[state.sort]);
}

function renderVenueList() {
  const list = visibleVenues();
  $("#venue-count").textContent = state.venues.length || "";
  const el = $("#venue-list");
  if (state.venues.length && !list.length) {
    el.innerHTML = `<li class="empty">No venues match this filter${state.filter === "live" ? " right now" : ""}.</li>`;
    return;
  }
  el.innerHTML = list
    .map((v) => {
      const st = statusText(v);
      const picked = state.picks.includes(v.id);
      return `<li class="venue-card" data-id="${esc(v.id)}">
        <div class="venue-head">
          <h3>${esc(v.name)}</h3>
          <span class="kind">${esc(KIND_LABELS[v.kind] || v.kind)}</span>
        </div>
        <div class="venue-meta">${formatDistance(v.distance)} away${v.address ? ` · ${esc(v.address)}` : ""}</div>
        <div class="hh-status ${st.cls}"><i class="dot ${st.cls}"></i>${esc(st.text)}</div>
        <div class="venue-meta">${esc(describeSchedule(v.rules).join(" · "))}
          <span class="badge ${v.scheduleSource}">${SOURCE_LABELS[v.scheduleSource]}</span></div>
        ${v.cheapest ? `<div class="deal">Drinks from <strong>${price(v.cheapest.happy)}</strong> <s>${price(v.cheapest.regular)}</s> <span class="muted">${esc(v.cheapest.name)}</span></div>` : ""}
        <div class="card-actions">
          <button class="btn btn-small" data-action="menu">Menu &amp; prices</button>
          <button class="btn btn-small ${picked ? "btn-picked" : ""}" data-action="pick">${picked ? "✓ In crawl" : "+ Add to crawl"}</button>
        </div>
      </li>`;
    })
    .join("");
}

$("#venue-list").addEventListener("click", (e) => {
  const card = e.target.closest(".venue-card");
  if (!card) return;
  const id = card.dataset.id;
  const action = e.target.closest("[data-action]")?.dataset.action;
  if (action === "menu") openVenue(id);
  else if (action === "pick") togglePick(id);
  else {
    const v = state.venues.find((x) => x.id === id);
    map.setView([v.lat, v.lon], Math.max(map.getZoom(), 16));
    markers.get(id)?.openTooltip();
  }
});

// ---------- Venue detail ----------

function menuTable(v, active) {
  return v.menu
    .map(
      (s) => `<h4>${esc(s.section)}</h4>
      <table class="menu">
        <thead><tr><th>Item</th><th>Regular</th><th>Happy hour</th><th></th></tr></thead>
        <tbody>${s.items
          .map((i) => {
            const save = i.regular > 0 ? Math.round((1 - i.happy / i.regular) * 100) : 0;
            return `<tr class="${active ? "hh-on" : ""}"><td>${esc(i.name)}</td><td>${price(i.regular)}</td>
              <td><strong>${price(i.happy)}</strong></td><td class="save">${save > 0 ? `−${save}%` : ""}</td></tr>`;
          })
          .join("")}</tbody>
      </table>`,
    )
    .join("");
}

function openVenue(id) {
  const v = state.venues.find((x) => x.id === id);
  if (!v) return;
  const st = statusText(v);
  const web = safeUrl(v.website);
  const estimated = v.scheduleSource === "estimated" || v.menuSource === "estimated";
  $("#dialog-body").innerHTML = `
    <button class="close" data-close aria-label="Close">×</button>
    <h2>${esc(v.name)}</h2>
    <div class="venue-meta">${esc(KIND_LABELS[v.kind] || v.kind)} · ${formatDistance(v.distance)} away${v.address ? ` · ${esc(v.address)}` : ""}</div>
    <div class="hh-status ${st.cls}"><i class="dot ${st.cls}"></i>${esc(st.text)}</div>
    <section>
      <h3>Happy hour <span class="badge ${v.scheduleSource}">${SOURCE_LABELS[v.scheduleSource]}</span></h3>
      <ul class="schedule">${describeSchedule(v.rules).map((l) => `<li>${esc(l)}</li>`).join("") || "<li>None listed</li>"}</ul>
      ${v.openingHours ? `<div class="venue-meta">Opening hours: ${esc(v.openingHours)}</div>` : ""}
    </section>
    <section>
      <h3>Menu &amp; prices <span class="badge ${v.menuSource}">${SOURCE_LABELS[v.menuSource]}</span></h3>
      ${menuTable(v, st.cls === "live")}
    </section>
    ${estimated ? `<p class="note">Estimated details are typical for this kind of venue in this area, not the venue's published offer. Check with the venue, then use <em>Correct these details</em> to save the real ones.</p>` : ""}
    <div class="links">
      ${web ? `<a class="btn btn-small" href="${esc(web)}" target="_blank" rel="noopener">Website</a>` : ""}
      ${v.phone ? `<a class="btn btn-small" href="tel:${esc(v.phone.replace(/[^+\d]/g, ""))}">Call ${esc(v.phone)}</a>` : ""}
      <a class="btn btn-small" href="${esc(appleWalkUrl(v))}" target="_blank" rel="noopener">Apple Maps</a>
      <a class="btn btn-small" href="${esc(googleWalkUrl(v))}" target="_blank" rel="noopener">Google Maps</a>
      <a class="btn btn-small" href="https://www.openstreetmap.org/${esc(v.id)}" target="_blank" rel="noopener">OSM</a>
      <button class="btn btn-small" data-action="pick">${state.picks.includes(v.id) ? "✓ In crawl" : "+ Add to crawl"}</button>
      <button class="btn btn-small" data-action="edit">Correct these details</button>
    </div>
    <form class="editor" hidden>
      <label>Happy hour times
        <input name="schedule" value="${esc(v.scheduleText)}" placeholder="Mo-Fr 16:00-18:00; Sa 14:00-17:00">
      </label>
      <p class="hint">Days: Mo Tu We Th Fr Sa Su, ranges like <code>Mo-Fr</code>, lists like <code>Fr,Sa</code>. Separate rules with <code>;</code>.</p>
      <label>Menu (one item per line: <code>Name | regular price | happy-hour price</code>, sections start with <code>#</code>)
        <textarea name="menu" rows="10">${esc(menuToText(v.menu))}</textarea>
      </label>
      <div class="links">
        <button class="btn btn-primary btn-small" type="submit">Save</button>
        ${v.scheduleSource === "user" || v.menuSource === "user" ? `<button class="btn btn-small" type="button" data-action="reset">Remove my corrections</button>` : ""}
      </div>
    </form>`;

  const dlg = $("#venue-dialog");
  const body = $("#dialog-body");
  body.onclick = (e) => {
    const action = e.target.closest("[data-action]")?.dataset.action;
    if (e.target.closest("[data-close]")) dlg.close();
    else if (action === "pick") {
      togglePick(v.id);
      openVenue(v.id);
    } else if (action === "edit") body.querySelector(".editor").hidden = false;
    else if (action === "reset") {
      clearOverride(v.id);
      afterVenueEdit(v.id);
    }
  };
  body.querySelector(".editor").onsubmit = (e) => {
    e.preventDefault();
    const form = e.target;
    const schedule = form.schedule.value.trim();
    if (schedule && !parseSchedule(schedule).length) {
      toast("Couldn't read those times. Try a format like Mo-Fr 16:00-18:00.");
      return;
    }
    const menu = textToMenu(form.menu.value);
    saveOverride(v.id, { schedule: schedule || null, menu });
    afterVenueEdit(v.id);
    toast("Saved in this browser.");
  };
  if (!dlg.open) dlg.showModal();
}

function afterVenueEdit(id) {
  rebuildVenues();
  if (state.plans.length) refreshCurrentPlan();
  openVenue(id);
}

$("#venue-dialog").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) e.currentTarget.close(); // backdrop click
});

// ---------- Crawl ----------

function togglePick(id) {
  const i = state.picks.indexOf(id);
  if (i >= 0) state.picks.splice(i, 1);
  else if (state.picks.length >= CRAWL_STOPS) {
    toast(`A crawl has ${CRAWL_STOPS} stops. Remove one first.`);
    return;
  } else state.picks.push(id);
  renderVenueList();
  renderPicks();
}

function renderPicks() {
  const picks = state.picks.map((id) => state.venues.find((v) => v.id === id)).filter(Boolean);
  $("#crawl-count").textContent = state.plans.length ? CRAWL_STOPS : picks.length || "";
  const el = $("#picks");
  if (!picks.length) {
    el.innerHTML = `<p class="hint">Pick up to 3 venues with <em>+ Add to crawl</em>, or let the planner choose the best-timed route for you.</p>`;
    return;
  }
  el.innerHTML = `<p class="hint">Your picks (${picks.length}/${CRAWL_STOPS})${picks.length < CRAWL_STOPS ? " — the planner fills the rest" : " — the planner picks the best order"}:</p>
    <ul class="pick-list">${picks
      .map((v) => `<li>${esc(v.name)} <button class="link" data-unpick="${esc(v.id)}" aria-label="Remove ${esc(v.name)}">remove</button></li>`)
      .join("")}</ul>`;
}

$("#picks").addEventListener("click", (e) => {
  const id = e.target.dataset.unpick;
  if (id) togglePick(id);
});

function stayMins() {
  return Number($("#stay-select").value);
}

function planStart() {
  // Start planning from the chosen time, rounded up to the next 5 minutes.
  const d = new Date(now());
  d.setSeconds(0, 0);
  d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5);
  return d;
}

function planCrawl() {
  if (!state.origin) return toast("Set a location first.");
  if (state.venues.length < CRAWL_STOPS) return toast("Not enough venues nearby for a 3-stop crawl.");
  const required = state.picks.map((id) => state.venues.find((v) => v.id === id)).filter(Boolean);
  state.plans = planCrawls(state.venues, state.origin, planStart(), stayMins(), { required });
  state.planIndex = 0;
  renderCrawl();
}

// Re-simulates the shown plan with updated venue data or settings.
function refreshCurrentPlan() {
  const plan = state.plans[state.planIndex];
  if (!plan) return;
  const venues = plan.stops.map((s) => state.venues.find((v) => v.id === s.venue.id)).filter(Boolean);
  if (venues.length === CRAWL_STOPS) state.plans[state.planIndex] = bestOrder(venues, state.origin, planStart(), stayMins());
  renderCrawl();
}

function crawlSummaryText(plan) {
  const lines = [`🍺 Happy hour crawl — ${plan.stops[0].arrive.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" })}`];
  plan.stops.forEach((s, i) => {
    lines.push(`${i + 1}. ${s.venue.name} — ${clock(s.arrive)}–${clock(s.leave)}${s.drink ? ` (${s.drink.name} ${price(s.hhMins ? s.drink.happy : s.drink.regular)})` : ""}`);
  });
  lines.push(`Walking: ${formatDistance(plan.totalWalkM)} · Est. spend ${price(plan.cost)} pp`);
  lines.push(directionsUrl(state.origin, plan));
  return lines.join("\n");
}

function renderCrawl() {
  renderPicks();
  const el = $("#crawl-result");
  crawlLayer.clearLayers();
  $("#another-btn").disabled = state.plans.length < 2;
  const plan = state.plans[state.planIndex];
  if (!plan) {
    el.innerHTML = state.venues.length ? "" : `<p class="hint">Set a location to plan a crawl.</p>`;
    return;
  }
  const full = plan.stops.filter((s) => s.hhMins >= plan.stayMins).length;
  el.innerHTML = `
    <div class="crawl-summary">
      <div><span class="big">${clock(plan.stops[0].arrive)}–${clock(plan.finish)}</span><span class="muted">first drink to last</span></div>
      <div><span class="big">${formatDistance(plan.totalWalkM)}</span><span class="muted">${plan.totalWalkMin} min walking</span></div>
      <div><span class="big">${price(plan.cost)}</span><span class="muted">est. per person*</span></div>
    </div>
    ${full < CRAWL_STOPS ? `<p class="note">${CRAWL_STOPS - full === 1 ? "1 stop falls" : `${CRAWL_STOPS - full} stops fall`} partly or fully outside happy hour at this time. Try a different <em>When</em> time for better deals.</p>` : ""}
    <ol class="timeline">
      ${plan.stops
        .map((s, i) => {
          const cover = s.hhMins >= plan.stayMins ? "live" : s.hhMins > 0 ? "later" : "off";
          const coverText = s.hhMins >= plan.stayMins ? "Happy hour the whole stay" : s.hhMins > 0 ? `Happy hour for ${s.hhMins} of ${plan.stayMins} min` : "Outside happy hour";
          return `<li>
            <div class="walk">🚶 ${s.walkMin} min · ${formatDistance(s.walkM)} ${i === 0 ? "from your pin" : "from previous stop"}
              · <a href="${esc(appleWalkUrl(s.venue, i ? plan.stops[i - 1].venue : state.origin))}" target="_blank" rel="noopener">Apple Maps</a>
              · <a href="${esc(googleWalkUrl(s.venue, i ? plan.stops[i - 1].venue : state.origin))}" target="_blank" rel="noopener">Google Maps</a></div>
            <div class="stop">
              <div class="stop-num">${i + 1}</div>
              <div class="stop-body">
                <div class="venue-head"><h3>${esc(s.venue.name)}</h3><span class="kind">${esc(KIND_LABELS[s.venue.kind] || s.venue.kind)}</span></div>
                <div class="venue-meta"><strong>${clock(s.arrive)}–${clock(s.leave)}</strong> · ${esc(describeSchedule(s.venue.rules).join(" · "))}</div>
                <div class="hh-status ${cover}"><i class="dot ${cover}"></i>${coverText}</div>
                ${s.drink ? `<div class="deal">Order: ${esc(s.drink.name)} <strong>${price(s.hhMins ? s.drink.happy : s.drink.regular)}</strong></div>` : ""}
                ${s.snack ? `<div class="deal">Snack: ${esc(s.snack.name)} <strong>${price(s.hhMins ? s.snack.happy : s.snack.regular)}</strong></div>` : ""}
                <button class="btn btn-small" data-open="${esc(s.venue.id)}">Full menu &amp; prices</button>
              </div>
            </div>
          </li>`;
        })
        .join("")}
    </ol>
    <div class="links">
      <a class="btn btn-primary btn-small" href="${esc(directionsUrl(state.origin, plan))}" target="_blank" rel="noopener">Whole route in Google Maps</a>
      <button class="btn btn-small" id="share-btn">Share crawl</button>
    </div>
    <p class="hint">*Two drinks per stop plus one snack, at happy-hour prices while the deal is on. Walking times assume 4.8 km/h on streets roughly 30% longer than a straight line. Route ${state.planIndex + 1} of ${state.plans.length}.</p>`;

  // Map route
  const pts = [[state.origin.lat, state.origin.lon], ...plan.stops.map((s) => [s.venue.lat, s.venue.lon])];
  L.polyline(pts, { color: "#f5a524", weight: 4, dashArray: "8 8" }).addTo(crawlLayer);
  plan.stops.forEach((s, i) =>
    L.marker([s.venue.lat, s.venue.lon], {
      icon: L.divIcon({ className: "crawl-pin", html: `<span>${i + 1}</span>`, iconSize: [28, 28] }),
      zIndexOffset: 1000,
    })
      .bindTooltip(`${i + 1}. ${esc(s.venue.name)} · ${clock(s.arrive)}`)
      .on("click", () => openVenue(s.venue.id))
      .addTo(crawlLayer),
  );
  map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 17 });
  $("#crawl-count").textContent = CRAWL_STOPS;
}

$("#crawl-result").addEventListener("click", async (e) => {
  const open = e.target.closest("[data-open]")?.dataset.open;
  if (open) return openVenue(open);
  if (e.target.id === "share-btn") {
    const text = crawlSummaryText(state.plans[state.planIndex]);
    try {
      if (navigator.share) await navigator.share({ title: "Happy hour crawl", text });
      else {
        await navigator.clipboard.writeText(text);
        toast("Crawl copied to clipboard.");
      }
    } catch (err) {
      if (err?.name !== "AbortError") toast("Couldn't share. Try again.");
    }
  }
});

$("#plan-btn").addEventListener("click", planCrawl);
$("#another-btn").addEventListener("click", () => {
  state.planIndex = (state.planIndex + 1) % state.plans.length;
  renderCrawl();
});
$("#stay-select").addEventListener("change", () => state.plans.length && planCrawl());

// ---------- Controls ----------

function renderAll() {
  renderVenueList();
  drawVenueMarkers();
  if (state.plans.length) refreshCurrentPlan();
  else renderCrawl();
}

document.querySelectorAll(".tab").forEach((tab) =>
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => {
      t.classList.toggle("active", t === tab);
      t.setAttribute("aria-selected", t === tab);
    });
    $("#tab-venues").hidden = tab.dataset.tab !== "venues";
    $("#tab-crawl").hidden = tab.dataset.tab !== "crawl";
  }),
);

document.querySelectorAll(".chip").forEach((chip) =>
  chip.addEventListener("click", () => {
    document.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c === chip));
    state.filter = chip.dataset.filter;
    renderVenueList();
  }),
);

$("#sort-select").addEventListener("change", (e) => {
  state.sort = e.target.value;
  renderVenueList();
});

$("#name-filter").addEventListener("input", (e) => {
  state.nameFilter = e.target.value.trim().toLowerCase();
  renderVenueList();
});

function toLocalInput(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

$("#when-input").value = toLocalInput(new Date());
$("#when-input").addEventListener("change", (e) => {
  const d = e.target.value ? new Date(e.target.value) : null;
  state.when = d && !isNaN(d) ? d : null;
  state.plans = [];
  renderAll();
});
$("#now-btn").addEventListener("click", () => {
  state.when = null;
  $("#when-input").value = toLocalInput(new Date());
  state.plans = [];
  renderAll();
});

// Keep "now" statuses fresh while the page stays open.
setInterval(() => {
  if (state.when || !state.venues.length) return;
  $("#when-input").value = toLocalInput(new Date());
  renderVenueList();
  drawVenueMarkers();
}, 60000);

$("#locate-btn").addEventListener("click", () => {
  if (!navigator.geolocation) return toast("Your browser doesn't support location. Search instead.");
  const btn = $("#locate-btn");
  btn.disabled = true;
  btn.textContent = "Locating…";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      btn.disabled = false;
      btn.textContent = "📍 Use my location";
      setLocation({ lat: pos.coords.latitude, lon: pos.coords.longitude });
    },
    (err) => {
      btn.disabled = false;
      btn.textContent = "📍 Use my location";
      toast(err.code === 1 ? "Location permission denied. Search or click the map instead." : "Couldn't get your location. Search instead.");
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
  );
});

const results = $("#search-results");
$("#search-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = $("#search-input").value.trim();
  if (!q) return;
  results.hidden = false;
  results.innerHTML = `<li class="muted">Searching…</li>`;
  try {
    const places = await searchPlaces(q);
    results.innerHTML = places.length
      ? places.map((p, i) => `<li><button type="button" data-i="${i}">${esc(p.label)}</button></li>`).join("")
      : `<li class="muted">No places found.</li>`;
    results.onclick = (ev) => {
      const i = ev.target.closest("[data-i]")?.dataset.i;
      if (i === undefined) return;
      const p = places[i];
      results.hidden = true;
      setLocation({ lat: p.lat, lon: p.lon, label: p.label.split(",").slice(0, 3).join(","), countryCode: p.countryCode });
    };
  } catch {
    results.innerHTML = `<li class="muted">Search is unavailable right now. Try again, or click the map.</li>`;
  }
});
document.addEventListener("click", (e) => {
  if (!e.target.closest("#search-form")) results.hidden = true;
});

// ---------- Start ----------

renderPicks();
renderMapsLinks();
try {
  const saved = JSON.parse(localStorage.getItem(LOCATION_KEY));
  if (saved?.lat != null) setLocation(saved);
} catch {
  // No saved location; wait for the user.
}
