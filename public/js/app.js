// Gatherly shared frontend. No frameworks, no external scripts.

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

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
      <a class="brand" href="/"><img src="/assets/logo-white.webp" alt="" width="26" height="31">Gatherly</a>
      <button class="nav-burger" aria-label="Menu" aria-expanded="false">&#9776;</button>
      <div class="nav-links" id="navLinks">
        ${links.map(([t, h]) => `<a href="${h}" class="${active === h ? "active" : ""}">${t}</a>`).join("")}
        <div class="nav-user-wrap" id="navUserWrap">
          <a class="btn btn-primary btn-sm nav-cta nav-login" id="navAuth" href="/login">Log in</a>
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

// Discord's CDN only serves power-of-two image sizes (16..4096). Requesting a
// non-power-of-two size (e.g. 56 or 72) makes the CDN reject the request, which
// is why the dropdown avatar was rendering blank. Snap to the nearest valid size.
function discordImgSize(px) {
  const allowed = [16, 32, 64, 128, 256, 512, 1024];
  return allowed.reduce((best, v) => (Math.abs(v - px) < Math.abs(best - px) ? v : best), 64);
}

// Build full Discord avatar URL from stored hash + discordId.
// auth.js stores just the hash; this reconstructs the CDN URL.
function avatarUrl(user, size = 64) {
  if (!user) return null;
  // If avatar looks like a full URL (legacy), use it directly.
  if (user.avatar && user.avatar.startsWith("http")) return user.avatar;
  // If avatar is a hash and we have discordId, build the CDN URL.
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

// Inline onerror="" attributes are blocked by the site's CSP, so any image
// that should hide itself on a broken load gets the .js-img-fallback class
// and is wired up here instead, right after it lands in the DOM.
function wireImgFallback(scope) {
  (scope || document).querySelectorAll("img.js-img-fallback").forEach((img) => {
    img.addEventListener("error", () => { img.style.display = "none"; }, { once: true });
  });
}

function buildUserButton(el, user) {
  const wrap = el.querySelector("#navUserWrap");
  wrap.innerHTML = `
    ${user.role ? `<a href="/admin" class="nav-controlroom">Control room<span class="nav-cr-badge" id="navCrBadge" hidden></span></a>` : ""}
    <button class="nav-user-btn" id="navAuth" type="button">
      ${avatarMarkup(user, 28)}
      <span class="nav-user-name">${esc(user.username)}</span>
      <span class="nav-user-caret">&#9662;</span>
    </button>`;
  wireImgFallback(wrap);

  // Live red notification count over Control room so staff stay on top of work.
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
      // Optional editable "clickbox" CTA — a glass button at the end of the message.
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
   ADVERTISING SLOTS — rotate staff-approved + house ads in any .ad-slot
   element on the page. House ads are weighted to show the majority of the
   time, and the ratio/seconds are configurable from Control Room -> Ads.
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
    if (!pool.length) return;            // empty .ad-slot is hidden via CSS
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
  renderNav(active);
  renderAnnouncements();
  renderNotifications();
  renderFooter();
  initReveal();
  tickCountdowns();
  renderAdSlots();
}
