// Gatherly shared frontend. No frameworks, no external scripts.

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const SCENARIO_LABELS = {
  "border-patrol": "Border Patrol",
  "pursuit": "Pursuit",
  "court-trial": "Court Trial",
  "weather-hazard": "Weather Hazard",
  "department-tryout": "Department Tryout",
  "miscellaneous-event": "Miscellaneous Event",
};
export const scenarioLabel = (s) => SCENARIO_LABELS[s] || s || "";

export async function api(path, opts = {}) {
  const r = await fetch(path, {
    headers: opts.body instanceof Blob || opts.body instanceof ArrayBuffer ? {} : { "Content-Type": "application/json" },
    credentials: "same-origin",
    ...opts,
    body: opts.body && !(opts.body instanceof Blob) && typeof opts.body !== "string" ? JSON.stringify(opts.body) : opts.body,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Request failed (${r.status}).`);
  return d;
}

let CURRENT_USER = null;
export const currentUser = () => CURRENT_USER;

/* =========================================================================
   ANALYTICS - tracks page views, clicks, and errors
   ========================================================================= */
function getOrCreateSession() {
  let s = sessionStorage.getItem("g_session");
  if (!s) { s = Math.random().toString(36).slice(2) + Date.now().toString(36); sessionStorage.setItem("g_session", s); }
  return s;
}

function trackEvent(type, extra = {}) {
  // Fire and forget - never let analytics block or throw
  try {
    const body = JSON.stringify({ type, page: location.pathname, session: getOrCreateSession(), ...extra });
    fetch("/api/admin?action=analytics-track", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
  } catch {}
}

function initAnalytics() {
  // Defer pageview until after page is interactive so it doesn't block rendering
  setTimeout(() => trackEvent("pageview"), 100);
  document.addEventListener("click", (e) => {
    const el = e.target.closest("a, button, [data-track]");
    if (!el) return;
    const target = el.dataset.track || el.textContent?.trim().slice(0, 60) || el.getAttribute("href")?.replace(location.origin, "") || "";
    if (target) trackEvent("click", { target });
  }, { passive: true });
}

/* =========================================================================
   ERROR OVERLAY - shows broken rocket on JS errors
   Only activates after page is fully loaded to avoid hiding content
   ========================================================================= */
const ROCKET_SVG = `<svg viewBox="0 0 120 160" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:90px;animation:g-wobble 1.4s ease-in-out infinite">
  <ellipse cx="60" cy="75" rx="22" ry="42" fill="#7fa8ff" opacity=".9"/>
  <polygon points="60,10 38,55 82,55" fill="#5b8fff"/>
  <ellipse cx="60" cy="55" rx="10" ry="10" fill="#1a1d2e" stroke="#7fa8ff" stroke-width="2"/>
  <rect x="38" y="95" width="10" height="22" rx="5" fill="#5b8fff" transform="rotate(-15 38 95)"/>
  <rect x="72" y="95" width="10" height="22" rx="5" fill="#5b8fff" transform="rotate(15 82 95)"/>
  <ellipse cx="60" cy="117" rx="12" ry="6" fill="#ff7a7a" opacity=".8" style="animation:g-flicker .5s ease-in-out infinite alternate"/>
  <g transform="translate(75,90)" style="animation:g-wrench 2s ease-in-out infinite">
    <rect x="0" y="0" width="5" height="22" rx="2.5" fill="#ffcf5c" transform="rotate(35 2.5 11)"/>
    <circle cx="3" cy="2" r="5" fill="none" stroke="#ffcf5c" stroke-width="2.5"/>
  </g>
</svg>`;

const OVERLAY_STYLES = `
  <style>
    .g-overlay{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;}
    .g-overlay-inner{max-width:440px;}
    .g-overlay h2{font-size:1.6rem;color:#fff;margin:16px 0 8px;}
    .g-overlay p{color:rgba(255,255,255,.65);margin-bottom:20px;font-size:.95rem;line-height:1.6;}
    .g-dt-badge{display:inline-block;background:rgba(255,207,92,.15);color:#ffcf5c;border:1px solid rgba(255,207,92,.3);border-radius:999px;padding:4px 14px;font-size:.78rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;margin-bottom:12px;}
    @keyframes g-wobble{0%,100%{transform:rotate(-4deg) translateY(0);}50%{transform:rotate(4deg) translateY(-8px);}}
    @keyframes g-flicker{0%{opacity:.4;}100%{opacity:1;}}
    @keyframes g-wrench{0%,100%{transform:translate(75px,90px) rotate(-10deg);}50%{transform:translate(75px,90px) rotate(20deg);}}
    @keyframes g-dt-float{0%,100%{transform:translateY(0) rotate(-3deg);}50%{transform:translateY(-12px) rotate(3deg);}}
  </style>`;

let _errorHandlingActive = false;

function showErrorOverlay(message = "An unexpected error occurred.") {
  if (!_errorHandlingActive) return; // Don't show during page load
  if (document.getElementById("g-error-overlay")) return;
  trackEvent("error", { message: String(message).slice(0, 200) });
  const overlay = document.createElement("div");
  overlay.id = "g-error-overlay";
  overlay.className = "g-overlay";
  overlay.style.cssText = "background:rgba(10,11,18,.93);backdrop-filter:blur(8px);";
  overlay.innerHTML = `${OVERLAY_STYLES}
    <div class="g-overlay-inner">
      <div style="display:flex;justify-content:center;margin-bottom:8px">${ROCKET_SVG}</div>
      <h2>Something went wrong</h2>
      <p>${esc(message)}</p>
      <button class="btn btn-sm" id="g-err-dismiss">Dismiss</button>
      <a class="btn btn-sm" href="/" style="margin-left:8px">Go home</a>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById("g-err-dismiss")?.addEventListener("click", () => overlay.remove());
}

function initErrorHandling() {
  window.addEventListener("error", (e) => {
    if (e.filename && !e.filename.includes(location.origin)) return;
    showErrorOverlay(e.message || "A script error occurred.");
  });
  window.addEventListener("unhandledrejection", (e) => {
    const msg = e.reason?.message || String(e.reason) || "An unhandled promise error occurred.";
    showErrorOverlay(msg);
  });
  // Only activate error overlay after page is fully rendered
  window.addEventListener("load", () => { _errorHandlingActive = true; }, { once: true });
}

/* =========================================================================
   DOWNTIME CHECK - fetches downtime state and shows overlay if active
   ========================================================================= */
async function checkDowntime() {
  if (location.pathname.startsWith("/admin")) return;
  try {
    const res = await fetch("/api/admin?action=downtime-get");
    if (!res.ok) return;
    const { downtime } = await res.json();
    if (!downtime?.active) return;
    showDowntimeOverlay(downtime);
  } catch {}
}

function showDowntimeOverlay(downtime) {
  if (document.getElementById("g-downtime-overlay")) return;
  const overlay = document.createElement("div");
  overlay.id = "g-downtime-overlay";
  overlay.className = "g-overlay";
  overlay.style.cssText = "background:rgba(10,11,18,.97);backdrop-filter:blur(14px) grayscale(1);z-index:99998;";

  const rocketDt = ROCKET_SVG.replace('style="width:90px;animation:g-wobble', 'style="width:100px;opacity:.7;animation:g-dt-float');

  overlay.innerHTML = `${OVERLAY_STYLES}
    <div class="g-overlay-inner">
      <div style="display:flex;justify-content:center;margin-bottom:8px">${rocketDt}</div>
      <div class="g-dt-badge">Maintenance</div>
      <h2>We're down for maintenance</h2>
      <p>${esc(downtime.message || "We are currently down for maintenance. We'll be back shortly.")}</p>
      <a class="btn" href="${esc(downtime.discordUrl || "https://discord.gg/gatherly")}" target="_blank" rel="noopener">
        Join our Discord to check the status &rarr;
      </a>
    </div>`;

  document.body.style.cssText += ";filter:blur(4px) grayscale(1);pointer-events:none;overflow:hidden;";
  document.body.appendChild(overlay);
  overlay.style.filter = "none";
  overlay.style.pointerEvents = "all";
}

/* =========================================================================
   NAV
   ========================================================================= */
export function renderNav(active = "") {
  const el = document.getElementById("nav");
  if (!el) return;
  const links = [
    ["Discover", "/events"], ["List event", "/advertise"], ["Reports", "/reports"],
    ["News", "/news"], ["Pricing", "/pricing"], ["Advertise", "/advertisers"], ["Support", "/contact"],
  ];
  el.className = "nav";
  el.innerHTML = `
    <div class="wrap nav-inner">
      <a class="brand" href="/"><img src="/assets/logo-white.webp" alt="" width="24" height="28">Gatherly</a>
      <span class="nav-divider" aria-hidden="true"></span>
      <button class="nav-burger" aria-label="Menu" aria-expanded="false">&#9776;</button>
      <div class="nav-links" id="navLinks">
        ${links.map(([t, h]) => `<a href="${h}" class="${active === h ? "active" : ""}">${t}</a>`).join("")}
        <div class="nav-user-wrap nav-right" id="navUserWrap">
          <a class="btn btn-sm nav-cta nav-login" id="navAuth" href="/login">Log in</a>
        </div>
      </div>
    </div>`;

  el.querySelector(".nav-burger").addEventListener("click", (e) => {
    const open = el.querySelector("#navLinks").classList.toggle("open");
    e.currentTarget.setAttribute("aria-expanded", open);
  });

  document.addEventListener("click", (e) => {
    const dd = document.getElementById("navDropdown");
    if (dd && !dd.contains(e.target) && !document.getElementById("navAuth")?.contains(e.target)) dd.remove();
  });

  api("/api/auth?action=me").then((d) => {
    if (!d.user) return;
    CURRENT_USER = d.user;
    buildUserButton(el, d.user);
  }).catch(() => {});
}

function discordImgSize(px) {
  const allowed = [16, 32, 64, 128, 256, 512, 1024];
  return allowed.reduce((best, v) => (Math.abs(v - px) < Math.abs(best - px) ? v : best), 64);
}

function avatarUrl(user, size = 64) {
  if (!user) return null;
  if (user.avatar && user.avatar.startsWith("http")) return user.avatar;
  if (user.avatar && user.discordId) {
    return `https://cdn.discordapp.com/avatars/${user.discordId}/${user.avatar}.png?size=${discordImgSize(size)}`;
  }
  return null;
}

function avatarMarkup(user, size = 28) {
  const url = avatarUrl(user, size * 2);
  if (url) return `<img src="${esc(url)}" alt="" width="${size}" height="${size}" style="border-radius:50%;display:block;object-fit:cover" class="js-img-fallback">`;
  const letter = (user.username || "?")[0].toUpperCase();
  return `<span style="width:${size}px;height:${size}px;border-radius:50%;background:var(--signal-deep);display:flex;align-items:center;justify-content:center;font-size:${Math.round(size * 0.42)}px;font-weight:700;color:#fff">${esc(letter)}</span>`;
}

export function wireImgFallback(scope) {
  (scope || document).querySelectorAll("img.js-img-fallback").forEach((img) => {
    img.addEventListener("error", () => { img.style.display = "none"; }, { once: true });
  });
}

function buildUserButton(el, user) {
  const wrap = el.querySelector("#navUserWrap");
  wrap.innerHTML = `
    ${user.role ? `<a href="/admin" class="nav-controlroom">Control room<span class="nav-cr-badge" id="navCrBadge" hidden></span></a>` : ""}
    <button class="nav-user-btn" id="navAuth" type="button">
      ${avatarMarkup(user, 26)}
      <span class="nav-user-name">${esc(user.globalName || user.username)}</span>
      <span class="nav-user-caret">&#9662;</span>
    </button>`;
  wireImgFallback(wrap);

  if (user.role) {
    const refreshBadge = () => api("/api/admin?action=pending-count").then((d) => {
      const b = document.getElementById("navCrBadge");
      if (!b) return;
      if (d.pending > 0) { b.textContent = d.pending > 99 ? "99+" : d.pending; b.hidden = false; }
      else b.hidden = true;
    }).catch(() => {});
    refreshBadge();
    setInterval(refreshBadge, 30000);
  }

  el.querySelector("#navAuth").addEventListener("click", (e) => {
    e.stopPropagation();
    const existing = document.getElementById("navDropdown");
    if (existing) { existing.remove(); return; }
    const btn = document.getElementById("navAuth");
    const rect = btn.getBoundingClientRect();
    const dd = document.createElement("div");
    dd.id = "navDropdown";
    dd.className = "nav-dropdown";
    dd.style.top = `${rect.bottom + 8}px`;
    dd.style.right = `${window.innerWidth - rect.right}px`;
    dd.innerHTML = `
      <div class="ndd-head">
        ${avatarMarkup(user, 36)}
        <div>
          <div class="ndd-name">${esc(user.username)}</div>
          ${user.globalName && user.globalName !== user.username ? `<div class="ndd-meta" style="font-size:.78rem;opacity:.7">${esc(user.globalName)}</div>` : ""}
          <div class="ndd-meta">${esc(planLabel(user.plan))} &middot; <b>${user.credits ?? 0} credits</b></div>
        </div>
      </div>
      <a href="/dashboard" class="ndd-item">Dashboard</a>
      <a href="/settings" class="ndd-item">Settings</a>
      <a href="/reports" class="ndd-item">My reports</a>
      ${user.role ? `<a href="/admin" class="ndd-item">Control room</a>` : ""}
      <div class="ndd-sep"></div>
      <button id="dropdownLogout" class="ndd-item ndd-danger" type="button">Sign out</button>`;
    document.body.appendChild(dd);
    wireImgFallback(dd);
    document.getElementById("dropdownLogout").onclick = async () => {
      try { await api("/api/auth?action=logout", { method: "POST" }); } catch {}
      location.href = "/";
    };
  });
}

const PLAN_NAMES = { free: "Gatherly", pro: "Gatherly Pro", ultra: "Gatherly Ultra" };
const normPlan = (p) => ({ patrol: "free", sergeant: "pro", commander: "ultra", network: "ultra" }[p] || p || "free");
export const planLabel = (p) => PLAN_NAMES[normPlan(p)] || "Gatherly";
export const planRank = (p) => ({ free: 0, pro: 1, ultra: 2 }[normPlan(p)] ?? 0);

export function renderAnnouncements() {
  api("/api/admin?action=content").then((d) => {
    const list = d?.content?.announcements || [];
    if (!list.length) return;
    const nav = document.getElementById("nav");
    if (!nav) return;
    const bar = document.createElement("div");
    bar.className = "announce-bar";
    bar.innerHTML = `<div class="wrap announce-inner"><span class="announce-dot"></span><span class="announce-text" id="announceText"></span></div>`;
    nav.parentNode.insertBefore(bar, nav.nextSibling);
    const textEl = bar.querySelector("#announceText");
    let i = 0;
    const show = () => {
      const a = list[i % list.length];
      textEl.classList.remove("in");
      void textEl.offsetWidth;
      const body = a.link ? `<a href="${esc(a.link)}">${esc(a.text)}</a>` : esc(a.text);
      const cta = a.cta && a.cta.text && a.cta.link
        ? `<a class="announce-cta" href="${esc(a.cta.link)}">${esc(a.cta.text)}</a>` : "";
      textEl.innerHTML = body + cta;
      textEl.classList.add("in");
      i++;
    };
    show();
    if (list.length > 1) setInterval(show, 10000);
  }).catch(() => {});
}

export function renderNotifications() {
  let dismissed = [];
  try { dismissed = JSON.parse(sessionStorage.getItem("gatherly_dismissed") || "[]"); } catch {}
  api("/api/admin?action=content").then((d) => {
    const list = (d?.content?.notifications || []).filter((n) => !dismissed.includes(n.id));
    if (!list.length) return;
    const n = list[0];
    const toast = document.createElement("div");
    toast.className = "g-toast";
    const safeImg = n.image && /^https?:\/\//i.test(n.image) ? n.image : null;
    toast.innerHTML = `
      <button class="g-toast-x" aria-label="Dismiss" type="button">&times;</button>
      ${safeImg ? `<img class="g-toast-img js-img-fallback" src="${esc(safeImg)}" alt="">` : ""}
      <div class="g-toast-title">${esc(n.title)}</div>
      ${n.body ? `<div class="g-toast-body">${esc(n.body)}</div>` : ""}
      ${n.link ? `<a class="g-toast-link" href="${esc(n.link)}">Open &rarr;</a>` : ""}`;
    document.body.appendChild(toast);
    wireImgFallback(toast);
    requestAnimationFrame(() => toast.classList.add("in"));
    toast.querySelector(".g-toast-x").onclick = () => {
      toast.classList.remove("in");
      setTimeout(() => toast.remove(), 300);
      try { dismissed.push(n.id); sessionStorage.setItem("gatherly_dismissed", JSON.stringify(dismissed)); } catch {}
    };
  }).catch(() => {});
}

export function initReveal() {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
  }, { threshold: 0.12 });
  document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
}

export function renderRadar(el, blips = [], label = "") {
  if (!el) return;
  const dots = blips.slice(0, 12).map((b, i) => {
    const a = (i * 137.5 * Math.PI) / 180;
    const r = 14 + (i % 5) * 16 + 8;
    const x = 100 + Math.cos(a) * r;
    const y = 100 + Math.sin(a) * r;
    const href = b.id ? `/events#${b.id}` : "/events";
    return `<a href="${href}">
      <circle class="radar-blip ${b.live ? "live" : ""}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${b.live ? "4.2" : "3.2"}" style="animation-delay:${(i * 0.55).toFixed(2)}s"><title>${esc(b.title)} - ${esc(b.scenario)}</title></circle>
      ${b.live ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="7" fill="none" stroke="var(--live)" stroke-width="1" opacity="0.3" style="animation:radar-ping 2s ease-out infinite;animation-delay:${(i * 0.4).toFixed(2)}s"/>` : ""}
    </a>`;
  }).join("");
  el.innerHTML = `
    <svg viewBox="0 0 200 200" role="img" aria-label="Radar of live and upcoming events" style="overflow:visible">
      ${[28, 56, 84].map((r) => `<circle class="radar-ring" cx="100" cy="100" r="${r}"/>`).join("")}
      <line class="radar-cross" x1="100" y1="14" x2="100" y2="186"/>
      <line class="radar-cross" x1="14" y1="100" x2="186" y2="100"/>
      ${dots}
    </svg>
    <div class="radar-sweep" aria-hidden="true"></div>
    ${label ? `<div class="radar-label">${esc(label)}</div>` : ""}`;
}

export function tickCountdowns() {
  const fmt = (ms) => {
    if (ms <= 0) return "now";
    const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
  };
  const update = () => document.querySelectorAll("[data-countdown]").forEach((el) => { el.textContent = fmt(new Date(el.dataset.countdown).getTime() - Date.now()); });
  update();
  setInterval(update, 1000);
}

export const fmtLocal = (iso) =>
  new Date(iso).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" });

export function initStatusDot() {
  const el = document.getElementById("prcStatus");
  if (!el) return;
  api("/api/erlc?action=status").then((d) => {
    el.classList.add(d.up ? "up" : "down");
    el.querySelector("span").textContent = d.up ? "ER:LC API operational" : "ER:LC API unreachable";
  }).catch(() => { el.classList.add("down"); el.querySelector("span").textContent = "ER:LC API status unknown"; });
}

export function renderFooter() {
  const el = document.getElementById("footer");
  if (!el) return;
  el.innerHTML = `
    <div class="wrap">
      <div class="foot-grid">
        <div>
          <a class="brand" href="/" style="margin-bottom:12px"><img src="/assets/logo-white.webp" alt="" width="24" height="28">Gatherly</a>
          <p style="font-size:.88rem;max-width:300px">The event layer for ER:LC roleplay. Advertise sessions, fill your server, and measure what happened with verified API data.</p>
        </div>
        <div><h4>Platform</h4><a href="/events">Discover events</a><a href="/advertise">List an event</a><a href="/reports">Engagement reports</a><a href="/pricing">Pricing</a></div>
        <div><h4>Community</h4><a href="/news">News</a><a href="/advertisers">Advertise on Gatherly</a><a href="/dashboard">Dashboard</a><a href="/settings">Settings</a></div>
        <div><h4>Company</h4><a href="/contact">Support</a><a href="/terms">Terms of Service</a><a href="/privacy">Privacy Policy</a></div>
      </div>
      <div class="foot-base">
        <span>&copy; ${new Date().getFullYear()} Gatherly. Not affiliated with Police Roleplay Community or Roblox Corp.</span>
        <span class="status-dot" id="prcStatus"><i></i><span>Checking ER:LC API&hellip;</span></span>
      </div>
    </div>`;
  initStatusDot();
}

/* =========================================================================
   ADVERTISING SLOTS
   ========================================================================= */
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

function adBanner(a) {
  const href = a.tracked ? `/api/ads?action=click&id=${encodeURIComponent(a.id)}` : esc(a.link || "#");
  const img = a.image ? `<img src="${esc(a.image)}" alt="" referrerpolicy="no-referrer" class="js-img-fallback">` : "";
  return `<a class="ad-banner ${a.tracked ? "" : "ad-house"}" href="${href}"${a.tracked ? ` rel="sponsored nofollow" target="_blank"` : ""}>
    ${img}<span class="ad-title">${esc(a.title || "")}</span>
    <span class="ad-cta">${a.tracked ? "Visit &rarr;" : "Learn more &rarr;"}</span>
    <span class="ad-flag">${a.tracked ? "Sponsored" : "Gatherly"}</span>
  </a>`;
}

function trackImpression(id) {
  try {
    const body = JSON.stringify({ id });
    if (navigator.sendBeacon) navigator.sendBeacon("/api/ads?action=impression", new Blob([body], { type: "application/json" }));
    else fetch("/api/ads?action=impression", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true });
  } catch {}
}

export function renderAdSlots() {
  const slots = [...document.querySelectorAll(".ad-slot[data-ad-slot]")];
  if (!slots.length) return;
  api("/api/ads?action=active").then(({ config, ads, house }) => {
    const pool = [];
    (ads || []).forEach((a) => { for (let i = 0; i < (config.advertiserWeight || 1); i++) pool.push({ ...a, tracked: true }); });
    (house || []).forEach((a) => { for (let i = 0; i < (config.houseWeight || 4); i++) pool.push({ ...a, tracked: false }); });
    if (!pool.length) return;
    shuffle(pool);
    const rot = Math.max(3, config.rotateSec || 8) * 1000;
    slots.forEach((slot, si) => {
      let idx = si % pool.length;
      const show = () => {
        const a = pool[idx % pool.length]; idx++;
        slot.innerHTML = adBanner(a);
        wireImgFallback(slot);
        if (a.tracked) trackImpression(a.id);
      };
      show();
      setInterval(show, rot + si * 500);
    });
  }).catch(() => {});
}

export function boot(active) {
  initErrorHandling();
  initAnalytics();
  checkDowntime();
  renderNav(active);
  renderAnnouncements();
  renderNotifications();
  renderFooter();
  initReveal();
  tickCountdowns();
  renderAdSlots();
}
