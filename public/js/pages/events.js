import { boot, api, esc, scenarioLabel, fmtLocal, tickCountdowns } from "/js/app.js";
boot("/events");

const $ = (id) => document.getElementById(id);
const feed = $("feed");

let state = { q: "", filter: "all", scenario: "", duration: "", tz: "" };
let debounce = null;

/* ---- populate timezone selector ---- */
(function populateTz() {
  const sel = $("tzSelect");
  if (!sel) return;
  const zones = Intl.supportedValuesOf ? Intl.supportedValuesOf("timeZone") : [];
  const userTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  zones.forEach((z) => {
    const opt = document.createElement("option");
    opt.value = z;
    opt.textContent = z.replace(/_/g, " ");
    if (z === userTz) opt.selected = true;
    sel.appendChild(opt);
  });
  state.tz = userTz;
})();

/* ---- format time in selected tz ---- */
function fmtTz(iso, tz) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString([], {
      timeZone: tz || undefined,
      month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return fmtLocal(iso); }
}

/* ---- SVG icons ---- */
const ICON_CLOCK = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
const ICON_USER  = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
const ICON_TIME  = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;

/* ---- render one card ---- */
function card(e) {
  const live = e.live;
  const scenLabel = scenarioLabel(e.scenario) || e.scenario || "";
  const timeStr = fmtTz(live ? e.endsAt : e.startsAt, state.tz);
  const countdownLabel = live ? "Ends in" : "Starts in";

  return `
  <article class="ev-card ${e.boosted ? "boosted" : ""} ${live ? "is-live" : ""}" id="event-${esc(e.id)}">
    ${e.boosted ? `<div class="ev-boost-bar">Boosted · featured listing</div>` : ""}
    <div class="ev-banner">
      ${e.bannerUrl ? `<img src="${esc(e.bannerUrl)}" alt="" loading="lazy" class="js-img-fallback">` : ""}
      <div class="ev-banner-badges">
        ${live ? `<span class="badge badge-live">● Live</span>` : ""}
      </div>
      ${scenLabel ? `<div class="ev-banner-scenario">${esc(scenLabel)}</div>` : ""}
    </div>
    <div class="ev-body">
      <h3 class="ev-title">${esc(e.title)}</h3>
      ${e.description ? `<p class="ev-desc">${esc(e.description)}</p>` : ""}

      <div class="ev-meta">
        <span class="ev-meta-item">${ICON_USER}<span>Host <b style="color:var(--text)">${esc(e.hostUsername)}</b></span></span>
        <span class="ev-meta-item">${ICON_TIME}<span>${timeStr}</span></span>
        <span class="ev-meta-item">${ICON_CLOCK}<span><b style="color:var(--text)">${e.durationMin}m</b></span></span>
        <span class="ev-meta-item">${ICON_CLOCK}<span>${countdownLabel} <b class="countdown" style="color:var(--signal)" data-countdown="${esc(live ? (e.endsAt || "") : (e.startsAt || ""))}"></b></span></span>
      </div>

      ${e.playerCount != null ? `
      <div class="ev-live-bar">
        <span class="ldot"></span>
        <span><b>${e.playerCount}/${e.maxPlayers || 40}</b> ${live ? "in-game right now" : "in server"}</span>
        <div style="flex:1;height:4px;background:var(--line);border-radius:2px;overflow:hidden">
          <div style="height:100%;width:${Math.min(100, Math.round((e.playerCount / (e.maxPlayers || 40)) * 100))}%;background:${live ? "var(--live)" : "var(--signal)"};border-radius:2px;transition:width .4s"></div>
        </div>
      </div>` : ""}

      <div class="ev-footer">
        <button class="btn ${live ? "btn-primary" : "btn-ghost"} btn-sm" data-join="${esc(e.id)}">${live ? "⚡ Get join code" : "Join code at start"}</button>
      </div>
      <div class="ev-code-out alert alert-ok" hidden data-code="${esc(e.id)}"></div>
    </div>
  </article>`;
}

/* ---- load feed ---- */
async function load() {
  feed.innerHTML = `<div class="disc-loading"><div class="radar mini" id="feedRadar"></div><span>Scanning the feed…</span></div>`;
  const countEl = $("discCount");
  if (countEl) countEl.hidden = true;
  try {
    const params = new URLSearchParams({ action: "list", q: state.q, filter: state.filter });
    if (state.scenario) params.set("scenario", state.scenario);
    if (state.duration) params.set("duration", state.duration);
    const { events } = await api(`/api/events?${params}`);
    if (countEl) { countEl.innerHTML = `<b>${events.length}</b> event${events.length !== 1 ? "s" : ""} found`; countEl.hidden = false; }
    feed.innerHTML = events.length
      ? events.map(card).join("")
      : `<div class="disc-empty"><h3>${state.q || state.filter !== "all" || state.scenario || state.duration ? "Nothing matches" : "No events right now"}</h3><p>${state.q || state.filter !== "all" ? "Try different search terms or filters." : "Be the first — list an event and it appears here instantly."}</p><a href="/advertise" class="btn btn-primary btn-sm" style="margin-top:14px">List an event</a></div>`;
    tickCountdowns();
    if (location.hash) {
      const target = document.querySelector(location.hash.replace("#", "#event-"));
      if (target) setTimeout(() => target.scrollIntoView({ behavior: "smooth", block: "center" }), 300);
    }
  } catch {
    feed.innerHTML = `<div class="disc-empty"><h3>Feed unavailable</h3><p>Refresh to try again.</p></div>`;
  }
}

/* ---- pulse stats ---- */
async function loadPulse() {
  try {
    const { live, upcoming } = await api("/api/events?action=pulse");
    const lc = $("liveCount"), uc = $("upCount");
    if (lc) lc.textContent = live;
    if (uc) uc.textContent = upcoming;
  } catch {}
}

/* ---- join code ---- */
feed.addEventListener("click", async (ev) => {
  const btn = ev.target.closest("[data-join]");
  if (!btn) return;
  const id = btn.dataset.join;
  fetch(`/api/events?action=view&id=${encodeURIComponent(id)}`, { method: "POST" }).catch(() => {});
  const out = feed.querySelector(`[data-code="${CSS.escape(id)}"]`);
  try {
    const d = await api(`/api/events?action=join&id=${encodeURIComponent(id)}`);
    out.textContent = `Join code: ${d.joinCode}`;
    out.className = "ev-code-out alert alert-ok"; out.hidden = false;
  } catch (e) {
    out.textContent = e.message;
    out.className = "ev-code-out alert alert-err"; out.hidden = false;
  }
});

/* ---- search ---- */
$("searchInput").addEventListener("input", (e) => {
  state.q = e.target.value.trim();
  clearTimeout(debounce);
  debounce = setTimeout(load, 280);
});

/* ---- timezone ---- */
$("tzSelect")?.addEventListener("change", (e) => {
  state.tz = e.target.value;
  load();
});

/* ---- filter/scenario/duration chips ---- */
document.querySelectorAll("[data-filter]").forEach((chip) => {
  chip.addEventListener("click", () => {
    document.querySelectorAll("[data-filter]").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    state.filter = chip.dataset.filter;
    load();
  });
});

document.querySelectorAll("[data-scenario]").forEach((chip) => {
  chip.addEventListener("click", () => {
    document.querySelectorAll("[data-scenario]").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    state.scenario = chip.dataset.scenario;
    load();
  });
});

document.querySelectorAll("[data-duration]").forEach((chip) => {
  chip.addEventListener("click", () => {
    document.querySelectorAll("[data-duration]").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    state.duration = chip.dataset.duration;
    load();
  });
});

/* ---- init ---- */
loadPulse();
load();
setInterval(load, 45000);
setInterval(loadPulse, 30000);
