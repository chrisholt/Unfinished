import { haversine, formatDistance, SEARCH_RADIUS_M } from "./geo.js";
import { parseSchedule, statusAt, minutesUntil, formatDuration } from "./hours.js";
import { appleSearchUrl, googleSearchUrl, appleWalkUrl, googleWalkUrl } from "./maplinks.js";
import { VENUES, HOME, CHECKED_ON } from "./data/victoria.js";

const $ = (sel) => document.querySelector(sel);
const CITY = "Victoria, BC";

const venues = VENUES.map((v) => ({ ...v, rules: parseSchedule(v.schedule) }));

const state = {
  origin: HOME,
  filter: "all",
  sort: "distance",
  when: null, // null = live "now"
};

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

const now = () => state.when || new Date();
// 12-hour times to match the venues' own listings, e.g. "5 pm", "5:30 pm".
function clock(d) {
  const h = d.getHours() % 12 || 12;
  const m = d.getMinutes();
  return `${h}${m ? `:${String(m).padStart(2, "0")}` : ""} ${d.getHours() < 12 ? "am" : "pm"}`;
}
const fullAddress = (v) => `${v.name}, ${v.address.replace(/\s*\(.*\)$/, "")}, ${CITY}`;
const checkedOn = new Date(`${CHECKED_ON}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.hidden = true), 3500);
}

// ---------- Rendering ----------

function statusText(v) {
  const t = now();
  const st = statusAt(v.rules, t);
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
  let list = venues
    .map((v) => ({ ...v, distance: haversine(state.origin, v), status: statusText(v) }))
    .filter((v) => v.distance <= SEARCH_RADIUS_M);
  if (state.filter === "live") list = list.filter((v) => v.status.cls === "live");
  if (state.filter === "today") list = list.filter((v) => v.status.cls !== "off");
  const soonKey = (v) => {
    const st = statusAt(v.rules, t);
    return st.active ? -1 : st.nextStart ? st.nextStart - t : Infinity;
  };
  const sorters = {
    distance: (a, b) => a.distance - b.distance,
    soonest: (a, b) => soonKey(a) - soonKey(b) || a.distance - b.distance,
  };
  return list.sort(sorters[state.sort]);
}

function itemsHtml(v) {
  if (!v.items.length) return `<p class="muted">Menu items and prices aren't published online. Ask at the bar.</p>`;
  const sections = [...new Set(v.items.map((i) => i.section))];
  return sections
    .map(
      (s) => `<table class="menu">
        <caption>${esc(s)}</caption>
        <tbody>${v.items
          .filter((i) => i.section === s)
          .map((i) => `<tr><td>${esc(i.name)}</td>${i.price ? `<td class="hh">${esc(i.price)}</td>` : `<td class="hh none">no price listed</td>`}</tr>`)
          .join("")}</tbody>
      </table>`,
    )
    .join("");
}

function venueHtml(v) {
  const sources = v.sources
    .map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a>`)
    .join(" · ");
  return `<li class="venue">
    <h2>${esc(v.name)}</h2>
    <p class="meta">${esc(v.kind)} · about ${formatDistance(v.distance)} away · ${esc(v.address)}</p>
    <p class="hh-status ${v.status.cls}"><i class="dot ${v.status.cls}"></i>${esc(v.status.text)}</p>
    <p class="schedule"><strong>Happy hour:</strong> ${esc(v.hoursText)}</p>
    ${itemsHtml(v)}
    ${v.note ? `<p class="note">${esc(v.note)}</p>` : ""}
    <div class="actions">
      <a class="btn btn-small" href="${esc(appleWalkUrl(fullAddress(v)))}" target="_blank" rel="noopener">Apple Maps</a>
      <a class="btn btn-small" href="${esc(googleWalkUrl(fullAddress(v)))}" target="_blank" rel="noopener">Google Maps</a>
      ${v.website ? `<a class="btn btn-small" href="${esc(v.website)}" target="_blank" rel="noopener">Website</a>` : ""}
      ${v.phone ? `<a class="btn btn-small" href="tel:${esc(v.phone.replace(/[^+\d]/g, ""))}">Call</a>` : ""}
    </div>
    <p class="sources">Source: ${sources}</p>
  </li>`;
}

function render() {
  const atHome = state.origin === HOME;
  $("#location-line").innerHTML = `<strong>Within 2 km of</strong> ${atHome ? esc(HOME.label) : "your location"}`;
  $("#home-btn").hidden = atHome;
  $("#maps-links").innerHTML = `<span class="muted">Search more happy hours nearby in</span>
    <a class="btn btn-small" href="${esc(appleSearchUrl("happy hour", state.origin))}" target="_blank" rel="noopener">Apple Maps</a>
    <a class="btn btn-small" href="${esc(googleSearchUrl("happy hour", state.origin))}" target="_blank" rel="noopener">Google Maps</a>`;

  const list = visibleVenues();
  const status = $("#status");
  const inRange = venues.some((v) => haversine(state.origin, v) <= SEARCH_RADIUS_M);
  status.hidden = list.length > 0;
  status.innerHTML = !inRange
    ? "No researched happy hours within 2 km of here. So far this app covers James Bay and downtown Victoria. Use the Apple Maps or Google Maps buttons above to search here."
    : `No happy hours match this filter${state.filter === "live" ? " right now" : ""}.`;
  $("#venue-list").innerHTML = list.map(venueHtml).join("");
}

$("#footer").innerHTML = `Happy hour details were collected from the linked sources on ${esc(checkedOn)}.
  Venues change their deals, so check with the venue before you go. Distances are approximate, in a straight line.`;

// ---------- Controls ----------

document.querySelectorAll(".chip").forEach((chip) =>
  chip.addEventListener("click", () => {
    document.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c === chip));
    state.filter = chip.dataset.filter;
    render();
  }),
);

$("#sort-select").addEventListener("change", (e) => {
  state.sort = e.target.value;
  render();
});

function toLocalInput(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

$("#when-input").value = toLocalInput(new Date());
$("#when-input").addEventListener("change", (e) => {
  const d = e.target.value ? new Date(e.target.value) : null;
  state.when = d && !isNaN(d) ? d : null;
  render();
});
$("#now-btn").addEventListener("click", () => {
  state.when = null;
  $("#when-input").value = toLocalInput(new Date());
  render();
});

// Keep "now" statuses fresh while the page stays open.
setInterval(() => {
  if (state.when) return;
  $("#when-input").value = toLocalInput(new Date());
  render();
}, 60000);

$("#locate-btn").addEventListener("click", () => {
  if (!navigator.geolocation) return toast("Your browser doesn't support location.");
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
      state.origin = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      render();
    },
    (err) => {
      reset();
      toast(err.code === 1 ? "Location permission denied." : "Couldn't get your location.");
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
  );
});

$("#home-btn").addEventListener("click", () => {
  state.origin = HOME;
  render();
});

render();
