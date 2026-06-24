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
   ANALYTICS
   ========================================================================= */
function getOrCreateSession() {
  let s = sessionStorage.getItem("g_session");
  if (!s) { s = Math.random().toString(36).slice(2) + Date.now().toString(36); sessionStorage.setItem("g_session", s); }
  return s;
}

function trackEvent(type, extra = {}) {
  try {
    const body = JSON.stringify({ type, page: location.pathname, session: getOrCreateSession(), ...extra });
    if (navigator.sendBeacon) navigator.sendBeacon("/api/admin?action=analytics-track", new Blob([body], { type: "application/json" }));
    else fetch("/api/admin?action=analytics-track", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true });
  } catch {}
}

function initAnalytics() {
  // Page view
  trackEvent("pageview");

  // Click tracking - track meaningful clicks only
  document.addEventListener("click", (e) => {
    const el = e.target.closest("a, button, [data-track]");
    if (!el) return;
    const target = el.dataset.track || el.textContent?.trim().slice(0, 60) || el.href?.replace(location.origin, "") || "";
    trackEvent("click", { target });
  }, { passive: true });
}

/* =========================================================================
   ERROR OVERLAY
   ========================================================================= */
function showErrorOverlay(message = "An unexpected error occurred.", fatal = false) {
  if (document.getElementById("g-error-overlay")) return;
  trackEvent("error", { message: String(message).slice(0, 200) });

  const overlay = document.createElement("div");
  overlay.id = "g-error-overlay";
  overlay.innerHTML = `
    <div class="g-overlay-inner">
      <div class="g-rocket-wrap">
        <svg class="g-rocket" viewBox="0 0 120 160" fill="none" xmlns="http://www.w3.org/2000/svg">
          <g class="g-rocket-body">
            <ellipse cx="60" cy="75" rx="22" ry="42" fill="#7fa8ff" opacity=".9"/>
            <polygon points="60,10 38,55 82,55" fill="#5b8fff"/>
            <ellipse cx="60" cy="55" rx="10" ry="10" fill="#1a1d2e" stroke="#7fa8ff" stroke-width="2"/>
            <rect x="38" y="95" width="10" height="22" rx="5" fill="#5b8fff" transform="rotate(-15 38 95)"/>
            <rect x="72" y="95" width="10" height="22" rx="5" fill="#5b8fff" transform="rotate(15 82 95)"/>
            <ellipse cx="60" cy="117" rx="12" ry="6" fill="#ff7a7a" opacity=".8" class="g-flame"/>
          </g>
          <g class="g-wrench" transform="translate(75,90)">
            <rect x="0" y="0" width="5" height="22" rx="2.5" fill="#ffcf5c" transform="rotate(35 2.5 11)"/>
            <circle cx="3" cy="2" r="5" fill="none" stroke="#ffcf5c" stroke-width="2.5"/>
          </g>
        </svg>
      </div>
      <h2>Something went wrong</h2>
      <p>${esc(message)}</p>
      ${fatal ? "" : `<button class="btn btn-sm" onclick="document.getElementById('g-error-overlay').remove()">Dismiss</button>`}
      <a class="btn btn-sm" href="/" style="margin-left:8px">Go home</a>
    </div>
    <style>
      #g-error-overlay{position:fixed;inset:0;z-index:99999;background:rgba(10,11,18,.92);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;}
      #g-error-overlay .g-overlay-inner{max-width:420px;}
      #g-error-overlay h2{font-size:1.6rem;color:#fff;margin:16px 0 8px;}
      #g-error-overlay p{color:rgba(255,255,255,.65);margin-bottom:20px;font-size:.95rem;}
      #g-error-overlay .g-rocket-wrap{display:flex;justify-content:center;}
      #g-error-overlay .g-rocket{width:90px;animation:g-wobble 1.4s ease-in-out infinite;}
      #g-error-overlay .g-flame{animation:g-flicker .5s ease-in-out infinite alternate;}
      #g-error-overlay .g-wrench{animation:g-wrench-spin 2s ease-in-out infinite;}
      @keyframes g-wobble{0%,100%{transform:rotate(-4deg) translateY(0);}50%{transform:rotate(4deg) translateY(-6px);}}
      @keyframes g-flicker{0%{opacity:.5;rx:10;}100%{opacity:1;rx:14;}}
      @keyframes g-wrench-spin{0%,100%{transform:translate(75px,90px) rotate(0deg);}50%{transform:translate(75px,90px) rotate(25deg);}}
    </style>`;
  document.body.appendChild(overlay);
}

function initErrorHandling() {
  window.addEventListener("error", (e) => {
    if (e.filename && !e.filename.includes(location.origin)) return; // ignore third-party script errors
    showErrorOverlay(e.message || "A script error occurred.");
  });
  window.addEventListener("unhandledrejection", (e) => {
    const msg = e.reason?.message || String(e.reason) || "An unhandled error occurred.";
    showErrorOverlay(msg);
  });
}

/* =========================================================================
   DOWNTIME CHECK
   ========================================================================= */
async function checkDowntime() {
  // Skip downtime check on admin page so staff can always access it
  if (location.pathname.startsWith("/admin")) return;
  try {
    const { downtime } = await fetch("/api/admin?action=downtime-get").then(r => r.json());
    if (!downtime?.active) return;
    showDowntimeOverlay(downtime);
  } catch {}
}

function showDowntimeOverlay(downtime) {
  if (document.getElementById("g-downtime-overlay")) return;

  const overlay = document.createElement("div");
  overlay.id = "g-downtime-overlay";
  overlay.innerHTML = `
    <div class="g-overlay-inner">
      <div class="g-rocket-wrap">
        <svg class="g-rocket" viewBox="0 0 120 160" fill="none" xmlns="http://www.w3.org/2000/svg">
          <g class="g-rocket-body">
            <ellipse cx="60" cy="75" rx="22" ry="42" fill="#7fa8ff" opacity=".6"/>
            <polygon points="60,10 38,55 82,55" fill="#5b8fff" opacity=".6"/>
            <ellipse cx="60" cy="55" rx="10" ry="10" fill="#1a1d2e" stroke="#7fa8ff" stroke-width="2"/>
            <rect x="38" y="95" width="10" height="22" rx="5" fill="#5b8fff" opacity=".6" transform="rotate(-15 38 95)"/>
            <rect x="72" y="95" width="10" height="22" rx="5" fill="#5b8fff" opacity=".6" transform="rotate(15 82 95)"/>
            <ellipse cx="60" cy="117" rx="12" ry="6" fill="#ff7a7a" opacity=".4" class="g-flame"/>
          </g>
          <g class="g-wrench" transform="translate(75,90)">
            <rect x="0" y="0" width="5" height="22" rx="2.5" fill="#ffcf5c" transform="rotate(35 2.5 11)"/>
            <circle cx="3" cy="2" r="5" fill="none" stroke="#ffcf5c" stroke-width="2.5"/>
          </g>
        </svg>
      </div>
      <div class="g-dt-badge">Maintenance</div>
      <h2>We're down for maintenance</h2>
      <p>${esc(downtime.message || "We are currently down for maintenance. We'll be back shortly.")}</p>
      <a class="btn" href="${esc(downtime.discordUrl || "https://discord.gg/gatherly")}" target="_blank" rel="noopener">
        Join our Discord to check the status
      </a>
    </div>
    <style>
      #g-downtime-overlay{position:fixed;inset:0;z-index:99998;background:rgba(10,11,18,.97);backdrop-filter:blur(12px) grayscale(1);display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;}
      #g-downtime-overlay .g-overlay-inner{max-width:460px;}
      #g-downtime-overlay .g-rocket-wrap{display:flex;justify-content:center;margin-bottom:8px;}
      #g-downtime-overlay .g-rocket{width:100px;animation:g-dt-float 3s ease-in-out infinite;}
      #g-downtime-overlay .g-flame{animation:g-flicker .8s ease-in-out infinite alternate;}
      #g-downtime-overlay .g-wrench{animation:g-wrench-spin 2.5s ease-in-out infinite;}
      #g-downtime-overlay .g-dt-badge{display:inline-block;background:rgba(255,207,92,.15);color:#ffcf5c;border:1px solid rgba(255,207,92,.3);border-radius:999px;padding:4px 14px;font-size:.78rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;margin-bottom:12px;}
      #g-downtime-overlay h2{font-size:1.8rem;color:#fff;margin:0 0 10px;}
      #g-downtime-overlay p{color:rgba(255,255,255,.6);margin-bottom:24px;font-size:.95rem;line-height:1.6;}
      @keyframes g-dt-float{0%,100%{transform:translateY(0) rotate(-3deg);}50%{transform:translateY(-12px) rotate(3deg);}}
      @keyframes g-flicker{0%{opacity:.3;}100%{opacity:.7;}}
      @keyframes g-wrench-spin{0%,100%{transform:translate(75px,90px) rotate(-10deg);}50%{transform:translate(75px,90px) rotate(20deg);}}
    </style>`;

  // Blur and grey the page content behind
  document.body.style.filter = "blur(4px) grayscale(1)";
  document.body.style.pointerEvents = "none";
  document.body.appendChild(overlay);
  overlay.style.filter = "none";
  overlay.style.pointerEvents = "all";
}

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

function buildUserButton(nav, user) {
  const wrap = nav.querySelector("#navUserWrap");
  if (!wrap) return;
  const size = discordImgSize(56);
  const avatarUrl = user.avatar && user.discordId
    ? `https://cdn.discordapp.com/avatars/${user.discordId}/${user.avatar}.webp?size=${size}`
    : `https://cdn.discordapp.com/embed/avatars/${(BigInt(user.discordId || "0") >> 22n) % 6n}.png`;
  wrap.innerHTML = `<button class="nav-user-btn" id="navAuth" aria-label="Account menu">
    <img src="${esc(avatarUrl)}" width="28" height="28" class="nav-avatar js-img-fallback" alt="">
    <span>${esc(user.globalName || user.username)}</span>
  </button>`;
  wrap.querySelector("#navAuth").addEventListener("click", (e) => {
    e.stopPropagation();
    const existing = document.getElementById("navDropdown");
    if (existing) { existing.remove(); return; }
    const btn = e.currentTarget;
    const rect = btn.getBoundingClientRect();
    const dd = document.createElement("div");
    dd.id = "navDropdown";
    dd.className = "nav-dropdown";
    dd.style.cssText = `position:fixed;top:${rect.bottom + 6}px;right:${window.innerWidth - rect.right}px;z-index:9999;`;
    dd.innerHTML = `
      <a href="/dashboard">Dashboard</a>
      <a href="/settings">Settings</a>
      ${user.role === "admin" || user.role === "executive" ? `<a href="/admin">Control Room</a>` : ""}
      <hr style="border:none;border-top:1px solid var(--line);margin:6px 0">
      <a href="#" id="navSignOut">Sign out</a>`;
    document.body.appendChild(dd);
    dd.querySelector("#navSignOut")?.addEventListener("click", async (e) => {
      e.preventDefault();
      await api("/api/auth?action=logout", { method: "POST" }).catch(() => {});
      location.href = "/";
    });
  });
  const fallback = wrap.querySelector(".js-img-fallback");
  if (fallback) fallback.addEventListener("error", () => { fallback.style.display = "none"; }, { once: true });
}

export function renderAnnouncements() {
  api("/api/admin?action=content").then(({ content }) => {
    if (!content?.announcements?.length) return;
    const bar = document.createElement("div");
    bar.className = "announce-bar";
    bar.innerHTML = content.announcements.map((a) => {
      const cta = a.cta ? ` <a href="${esc(a.cta.link)}" class="announce-cta" target="_blank" rel="noopener">${esc(a.cta.text)}</a>` : "";
      return `<span>${esc(a.text)}${cta}</span>`;
    }).join("<span class='announce-sep'>·</span>");
    document.body.prepend(bar);
  }).catch(() => {});
}

export function renderNotifications() {
  api("/api/admin?action=content").then(({ content }) => {
    if (!content?.notifications?.length) return;
    content.notifications.forEach((n, i) => {
      setTimeout(() => {
        const el = document.createElement("div");
        el.className = "notif-toast";
        el.innerHTML = `
          ${n.image ? `<img src="${esc(n.image)}" class="notif-img js-img-fallback" alt="">` : ""}
          <div class="notif-body">
            <strong>${esc(n.title)}</strong>
            ${n.body ? `<p>${esc(n.body)}</p>` : ""}
            ${n.link ? `<a href="${esc(n.link)}" target="_blank" rel="noopener">Learn more</a>` : ""}
          </div>
          <button class="notif-close" aria-label="Dismiss">&times;</button>`;
        el.querySelector(".notif-close").addEventListener("click", () => el.remove());
        el.querySelector(".js-img-fallback")?.addEventListener("error", (e) => { e.target.style.display = "none"; }, { once: true });
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 8000);
      }, i * 800);
    });
  }).catch(() => {});
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

function wireImgFallback(host) {
  if (!host) return;
  host.querySelectorAll("img.js-img-fallback").forEach((img) => {
    img.addEventListener("error", () => { img.style.display = "none"; }, { once: true });
  });
}

function initStatusDot() {
  const dot = document.getElementById("prcStatus");
  if (!dot) return;
  fetch("/api/erlc?action=status").then(r => r.json()).then(d => {
    const up = d?.status === "up" || d?.online;
    dot.innerHTML = `<i style="background:${up ? "#69d99c" : "#ff7a7a"}"></i><span>ER:LC API ${up ? "operational" : "degraded"}</span>`;
  }).catch(() => { dot.style.display = "none"; });
}

function initReveal() {
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add("revealed"); obs.unobserve(e.target); } });
  }, { threshold: 0.12 });
  document.querySelectorAll(".reveal").forEach(el => obs.observe(el));
}

function tickCountdowns() {
  const els = document.querySelectorAll("[data-countdown]");
  if (!els.length) return;
  const tick = () => els.forEach(el => {
    const t = new Date(el.dataset.countdown).getTime() - Date.now();
    if (t <= 0) { el.textContent = "Started"; return; }
    const h = Math.floor(t / 3600000), m = Math.floor((t % 3600000) / 60000), s = Math.floor((t % 60000) / 1000);
    el.textContent = h ? `${h}h ${m}m` : m ? `${m}m ${s}s` : `${s}s`;
  });
  tick(); setInterval(tick, 1000);
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
