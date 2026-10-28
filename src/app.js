import { formatDistance } from "./geo.js";
import { statusAt, describeSchedule, minutesUntil, formatDuration, parseSchedule, formatClock, minutesOf } from "./hours.js";
import { currencyFor, formatPrice, menuToText, textToMenu } from "./menu.js";
import { fetchVenues, searchPlaces, reverseGeocode } from "./api.js";
import { enrichVenue, SOURCE_LABELS } from "./venues.js";
import { saveOverride, clearOverride } from "./store.js";
import { appleSearchUrl, googleSearchUrl, appleWalkUrl, googleWalkUrl } from "./maplinks.js";

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

// ---------- Location ----------

async function setLocation({ lat, lon, label = null, countryCode = null }) {
  state.origin = { lat, lon, label, countryCode };
  try {
    localStorage.setItem(LOCATION_KEY, JSON.stringify(state.origin));
  } catch {
    // Remembering the location is a convenience only.
  }
  renderLocationLine();
  await loadVenues();
}

function renderLocationLine() {
  const o = state.origin;
  $("#location-line").innerHTML = `<strong>Within 2 km of</strong> ${esc(o.label || `${o.lat.toFixed(4)}, ${o.lon.toFixed(4)}`)}`;
  renderMapsLinks();
}

// Hand-off to the phone's map apps, near the chosen spot (or "near me").
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
          setStatus("loading", `The venue server is busy. Trying backup server ${attempt - 1} of ${total - 1}…`);
        }
      },
    });
    if (id !== state.loadId) return;
    state.rawVenues = raw;
    rebuildVenues();
    if (!raw.length) setStatus("empty", "No pubs or bars are listed within 2 km here. Try the Apple Maps or Google Maps buttons above.");
    else setStatus(null);
  } catch (err) {
    if (id !== state.loadId) return;
    setStatus(
      "error",
      `${esc(err.message)} You can also search with the Apple Maps or Google Maps buttons above.
       <button class="btn btn-small" id="retry-btn">Retry</button>`,
    );
    $("#retry-btn")?.addEventListener("click", loadVenues);
  }
}

function rebuildVenues() {
  state.venues = state.rawVenues.map((v) => enrichVenue(v, state.currency));
  renderVenueList();
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
  const sameDay = st.nextStart.toDateString() === t.toDateString();
  const day = sameDay ? "" : `${st.nextStart.toLocaleDateString(undefined, { weekday: "short" })} `;
  return {
    cls: sameDay ? "later" : "off",
    text: `Starts ${day}${clock(st.nextStart)} · in ${formatDuration(minutesUntil(st.nextStart, t))}`,
  };
}

function visibleVenues() {
  const t = now();
  let list = state.venues.filter((v) => v.name.toLowerCase().includes(state.nameFilter));
  if (state.filter === "live") list = list.filter((v) => statusAt(v.rules, t).active);
  if (state.filter === "today") list = list.filter((v) => statusText(v).cls !== "off");
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

function menuHtml(v, active) {
  return v.menu
    .map(
      (s) => `<table class="menu ${active ? "hh-on" : ""}">
        <caption>${esc(s.section)}</caption>
        <thead><tr><th scope="col">Item</th><th scope="col">Happy hour</th><th scope="col">Usually</th></tr></thead>
        <tbody>${s.items
          .map(
            (i) => `<tr><td>${esc(i.name)}</td><td class="hh">${price(i.happy)}</td>
              <td class="reg">${i.happy < i.regular ? `<s>${price(i.regular)}</s>` : price(i.regular)}</td></tr>`,
          )
          .join("")}</tbody>
      </table>`,
    )
    .join("");
}

function venueHtml(v) {
  const st = statusText(v);
  const web = safeUrl(v.website);
  const hasUserInfo = v.scheduleSource === "user" || v.menuSource === "user";
  return `<li class="venue" data-id="${esc(v.id)}">
    <h2>${esc(v.name)}</h2>
    <p class="meta">${esc(KIND_LABELS[v.kind] || v.kind)} · ${formatDistance(v.distance)} away${v.address ? ` · ${esc(v.address)}` : ""}</p>
    <p class="hh-status ${st.cls}"><i class="dot ${st.cls}"></i>${esc(st.text)}</p>
    <p class="schedule"><strong>Happy hour:</strong> ${esc(describeSchedule(v.rules).join(", ") || "none listed")}
      <span class="badge ${v.scheduleSource}">${SOURCE_LABELS[v.scheduleSource]}</span></p>
    <div class="menu-head"><strong>Menu &amp; prices</strong> <span class="badge ${v.menuSource}">${SOURCE_LABELS[v.menuSource]}</span></div>
    ${menuHtml(v, st.cls === "live")}
    <div class="actions">
      <a class="btn btn-small" href="${esc(appleWalkUrl(v))}" target="_blank" rel="noopener">Apple Maps</a>
      <a class="btn btn-small" href="${esc(googleWalkUrl(v))}" target="_blank" rel="noopener">Google Maps</a>
      ${web ? `<a class="btn btn-small" href="${esc(web)}" target="_blank" rel="noopener">Website</a>` : ""}
      ${v.phone ? `<a class="btn btn-small" href="tel:${esc(v.phone.replace(/[^+\d]/g, ""))}">Call</a>` : ""}
    </div>
    <details class="editor">
      <summary>Correct these details</summary>
      <form>
        <label>Happy hour times
          <input name="schedule" value="${esc(v.scheduleText)}" placeholder="Mo-Fr 16:00-18:00; Sa 14:00-17:00">
        </label>
        <p class="hint">Days: Mo Tu We Th Fr Sa Su, ranges like <code>Mo-Fr</code>, lists like <code>Fr,Sa</code>. Separate rules with <code>;</code>.</p>
        <label>Menu (one item per line: <code>Name | usual price | happy-hour price</code>; sections start with <code>#</code>)
          <textarea name="menu" rows="8">${esc(menuToText(v.menu))}</textarea>
        </label>
        <div class="actions">
          <button class="btn btn-primary btn-small" type="submit">Save</button>
          ${hasUserInfo ? `<button class="btn btn-small" type="button" data-action="reset">Remove my corrections</button>` : ""}
        </div>
      </form>
    </details>
  </li>`;
}

function renderVenueList() {
  const list = visibleVenues();
  const el = $("#venue-list");
  if (state.venues.length && !list.length) {
    el.innerHTML = `<li class="empty">No venues match this filter${state.filter === "live" ? " right now" : ""}.</li>`;
    return;
  }
  el.innerHTML = list.map(venueHtml).join("");
}

$("#venue-list").addEventListener("submit", (e) => {
  e.preventDefault();
  const id = e.target.closest(".venue")?.dataset.id;
  const form = e.target;
  const schedule = form.schedule.value.trim();
  if (schedule && !parseSchedule(schedule).length) {
    toast("Couldn't read those times. Try a format like Mo-Fr 16:00-18:00.");
    return;
  }
  saveOverride(id, { schedule: schedule || null, menu: textToMenu(form.menu.value) });
  rebuildVenues();
  toast("Saved on this device.");
});

$("#venue-list").addEventListener("click", (e) => {
  if (e.target.closest("[data-action=reset]")) {
    clearOverride(e.target.closest(".venue").dataset.id);
    rebuildVenues();
    toast("Your corrections were removed.");
  }
});

// ---------- Controls ----------

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
  renderVenueList();
});
$("#now-btn").addEventListener("click", () => {
  state.when = null;
  $("#when-input").value = toLocalInput(new Date());
  renderVenueList();
});

// Keep "now" statuses fresh while the page stays open (skipped while the
// user is typing a correction, so their edit isn't wiped).
setInterval(() => {
  if (state.when || !state.venues.length || document.querySelector(".editor[open]")) return;
  $("#when-input").value = toLocalInput(new Date());
  renderVenueList();
}, 60000);

$("#locate-btn").addEventListener("click", () => {
  if (!navigator.geolocation) return toast("Your browser doesn't support location. Search instead.");
  const btn = $("#locate-btn");
  const reset = () => {
    btn.disabled = false;
    btn.textContent = "📍 Use my location";
  };
  btn.disabled = true;
  btn.textContent = "Locating…";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      reset();
      setLocation({ lat: pos.coords.latitude, lon: pos.coords.longitude });
    },
    (err) => {
      reset();
      toast(err.code === 1 ? "Location permission denied. Search for a place instead." : "Couldn't get your location. Search instead.");
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
    results.innerHTML = `<li class="muted">Search is unavailable right now. Try “Use my location”.</li>`;
  }
});
document.addEventListener("click", (e) => {
  if (!e.target.closest("#search-form")) results.hidden = true;
});

// ---------- Start ----------

renderMapsLinks();
try {
  const saved = JSON.parse(localStorage.getItem(LOCATION_KEY));
  if (saved?.lat != null) setLocation(saved);
} catch {
  // No saved location; wait for the user.
}
