import { boot, api, esc, scenarioLabel, fmtLocal, tickCountdowns } from "/js/app.js";
boot("/events");

const $ = (id) => document.getElementById(id);
const feed = $("feed");

let state = { q: "", filter: "all", scenario: "", duration: "", tz: "" };
let allEvents = [];
let visibleCount = 0;
const PAGE = 12;
let debounceTimer = null;

/* ---- timezone selector ---- */
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

/* ---- icons ---- */
const IC = {
  clock: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  user:  `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  cal:   `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
};

/* ---- render one card ---- */
function card(e) {
  const live = e.live;
  const scenLabel = scenarioLabel(e.scenario) || e.scenario || "";
  const timeStr = fmtTz(live ? e.endsAt : e.startsAt, state.tz);
  const fillPct = e.playerCount != null ? Math.min(100, Math.round((e.playerCount / (e.maxPlayers || 40)) * 100)) : null;
  const fillColor = fillPct != null ? (fillPct >= 80 ? "var(--bad)" : fillPct >= 50 ? "var(--live)" : "var(--signal)") : "var(--signal)";

  return `
  <article class="ev-card ${e.boosted ? "boosted" : ""} ${live ? "is-live" : ""}" id="evc-${esc(e.id)}">
    ${e.boosted ? `<div class="ev-boost-bar">Boosted · featured listing</div>` : ""}
    <div class="ev-banner">
      ${e.bannerUrl ? `<img src="${esc(e.bannerUrl)}" alt="" loading="lazy">` : ""}
      <div class="ev-banner-badges">
        ${live ? `<span class="badge badge-live" style="background:rgba(74,222,128,0.15);border:1px solid rgba(74,222,128,0.35);color:var(--good);display:flex;align-items:center;gap:5px"><span style="width:6px;height:6px;border-radius:50%;background:var(--good);animation:pulse 1.4s infinite"></span>Live</span>` : ""}
      </div>
      ${scenLabel ? `<div class="ev-scenario-tag">${esc(scenLabel)}</div>` : ""}
    </div>
    <div class="ev-body">
      <h3 class="ev-title">${esc(e.title)}</h3>
      ${e.description ? `<p class="ev-desc">${esc(e.description)}</p>` : ""}
      <div class="ev-meta">
        <span class="ev-meta-item">${IC.user}<span>${esc(e.hostUsername)}</span></span>
        <span class="ev-meta-item">${IC.cal}<span>${timeStr}</span></span>
        <span class="ev-meta-item">${IC.clock}<span>${e.durationMin}m</span></span>
        <span class="ev-meta-item">${IC.clock}<span>${live ? "Ends in" : "Starts in"} <b class="countdown" style="color:var(--signal)" data-countdown="${esc(live ? (e.endsAt || "") : (e.startsAt || ""))}"></b></span></span>
      </div>
      ${fillPct != null ? `
      <div>
        <div style="display:flex;justify-content:space-between;font-size:.7rem;color:var(--muted);margin-bottom:4px">
          <span>${e.playerCount}/${e.maxPlayers || 40} players</span>
          <span style="color:${fillColor}">${fillPct}% full</span>
        </div>
        <div class="ev-fill-bar"><div class="ev-fill-bar-inner" style="width:${fillPct}%;background:${fillColor}"></div></div>
      </div>` : ""}
      <div class="ev-footer">
        <button class="btn ${live ? "btn-primary" : "btn-ghost"} btn-sm" data-join="${esc(e.id)}" style="flex:1">
          ${live ? "Get join code" : "Join code at start"}
        </button>
      </div>
      <div class="ev-code-out alert alert-ok" hidden data-code="${esc(e.id)}"></div>
    </div>
  </article>`;
}

/* ---- render visible slice ---- */
function renderSlice() {
  const slice = allEvents.slice(0, visibleCount);
  const countEl = $("discMeta");
  const countText = $("discCount");

  if (allEvents.length === 0) {
    feed.innerHTML = `<div class="disc-empty"><h3>${state.q || state.filter !== "all" || state.scenario || state.duration ? "Nothing matches" : "No events right now"}</h3><p>${state.q || state.filter !== "all" ? "Try different search terms or filters." : "Be the first — list an event and it appears here instantly."}</p><a href="/advertise" class="btn btn-primary btn-sm" style="margin-top:14px">List an event</a></div>`;
    if (countEl) countEl.hidden = true;
    return;
  }

  feed.innerHTML = slice.map(card).join("") + `<div id="scrollSentinel"></div>`;
  if (countEl) {
    countText.innerHTML = `<b>${allEvents.length}</b> event${allEvents.length !== 1 ? "s" : ""} found${visibleCount < allEvents.length ? ` · showing <b>${visibleCount}</b>` : ""}`;
    countEl.hidden = false;
  }
  tickCountdowns();
  wireObserver();
}

/* ---- infinite scroll observer ---- */
function wireObserver() {
  const sentinel = $("scrollSentinel");
  if (!sentinel) return;
  const obs = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && visibleCount < allEvents.length) {
      visibleCount = Math.min(allEvents.length, visibleCount + PAGE);
      renderSlice();
    }
  }, { rootMargin: "200px" });
  obs.observe(sentinel);
}

/* ---- load from API ---- */
async function load() {
  feed.innerHTML = `<div class="disc-loading"><span>Loading events…</span></div>`;
  const countEl = $("discMeta");
  if (countEl) countEl.hidden = true;
  try {
    const params = new URLSearchParams({ action: "list", q: state.q, filter: state.filter });
    if (state.scenario) params.set("scenario", state.scenario);
    if (state.duration) params.set("duration", state.duration);
    const { events } = await api(`/api/events?${params}`);
    allEvents = events;
    visibleCount = Math.min(allEvents.length, PAGE);
    renderSlice();
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
  if (!out) return;
  try {
    const d = await api(`/api/events?action=join&id=${encodeURIComponent(id)}`);
    out.textContent = `Join code: ${d.joinCode}`;
    out.className = "ev-code-out alert alert-ok"; out.hidden = false;
  } catch (e) {
    out.textContent = e.message;
    out.className = "ev-code-out alert alert-err"; out.hidden = false;
  }
});

/* ---- filter toggle drawer ---- */
const filterToggle = $("filterToggle");
const filterDrawer = $("filterDrawer");
filterToggle?.addEventListener("click", () => {
  const open = filterDrawer.classList.toggle("open");
  filterToggle.classList.toggle("active", open);
});

/* ---- update active filter count badge ---- */
function updateFilterCount() {
  const n = (state.filter !== "all" ? 1 : 0) + (state.scenario ? 1 : 0) + (state.duration ? 1 : 0);
  const badge = $("filterCount");
  if (!badge) return;
  badge.textContent = n;
  badge.classList.toggle("show", n > 0);
  filterToggle?.classList.toggle("active", n > 0 || filterDrawer?.classList.contains("open"));
}

/* ---- search ---- */
$("searchInput")?.addEventListener("input", (e) => {
  state.q = e.target.value.trim();
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(load, 300);
});

/* ---- timezone ---- */
$("tzSelect")?.addEventListener("change", (e) => { state.tz = e.target.value; renderSlice(); });

/* ---- chip handlers ---- */
document.querySelectorAll("[data-filter]").forEach((chip) => {
  chip.addEventListener("click", () => {
    document.querySelectorAll("[data-filter]").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    state.filter = chip.dataset.filter;
    updateFilterCount(); load();
  });
});
document.querySelectorAll("[data-scenario]").forEach((chip) => {
  chip.addEventListener("click", () => {
    document.querySelectorAll("[data-scenario]").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    state.scenario = chip.dataset.scenario;
    updateFilterCount(); load();
  });
});
document.querySelectorAll("[data-duration]").forEach((chip) => {
  chip.addEventListener("click", () => {
    document.querySelectorAll("[data-duration]").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    state.duration = chip.dataset.duration;
    updateFilterCount(); load();
  });
});

/* ---- init ---- */
loadPulse();
load();
setInterval(load, 45000);
setInterval(loadPulse, 30000);

