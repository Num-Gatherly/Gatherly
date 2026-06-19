import { boot, api, esc } from "/js/app.js";
boot("/");

/* ==========================================================================
   HOME RADAR — homepage-only, separate from the shared renderRadar() in
   app.js (which dashboard.js and reports.js also use, so it's left alone).
   Two blip types instead of one:
     - signal/live blips: live or upcoming events, click -> /events#id
     - green blips: the most recent published news articles, click -> /news
   ========================================================================== */
function renderHomeRadar(el, eventBlips, newsBlips, label) {
  if (!el) return;
  const all = [
    ...eventBlips.slice(0, 9).map((b) => ({ ...b, kind: "event" })),
    ...newsBlips.slice(0, 3).map((n) => ({ ...n, kind: "news" })),
  ];
  const dots = all.map((b, i) => {
    const a = (i * 137.5 * Math.PI) / 180;
    const r = 14 + (i % 5) * 16 + 8;
    const x = 100 + Math.cos(a) * r;
    const y = 100 + Math.sin(a) * r;
    const isNews = b.kind === "news";
    const href = isNews ? `/news?slug=${encodeURIComponent(b.slug)}` : (b.id ? `/events#${b.id}` : "/events");
    const titleText = isNews ? `Latest: ${b.title}` : `${b.title} - ${b.scenario || ""}`;
    const ringColor = isNews ? "var(--good)" : "var(--live)";
    return `<a href="${href}">
      <circle class="radar-blip ${isNews ? "news" : b.live ? "live" : ""}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${isNews ? "4.6" : b.live ? "4.2" : "3.2"}" style="animation-delay:${(i * 0.5).toFixed(2)}s"><title>${esc(titleText)}</title></circle>
      ${isNews || b.live ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="7" fill="none" stroke="${ringColor}" stroke-width="1" opacity="0.35" style="animation:radar-ping 2.2s ease-out infinite;animation-delay:${(i * 0.4).toFixed(2)}s"/>` : ""}
    </a>`;
  }).join("");
  el.innerHTML = `
    <svg viewBox="0 0 200 200" role="img" aria-label="Radar of live events and latest news" style="overflow:visible">
      ${[28, 56, 84].map((r) => `<circle class="radar-ring" cx="100" cy="100" r="${r}"/>`).join("")}
      <line class="radar-cross" x1="100" y1="14" x2="100" y2="186"/>
      <line class="radar-cross" x1="14" y1="100" x2="186" y2="100"/>
      ${dots}
    </svg>
    <div class="radar-sweep" aria-hidden="true"></div>
    ${label ? `<div class="radar-label">${esc(label)}</div>` : ""}`;
}

let pulseBlips = [];
let newsBlips = [];
function paintRadar() {
  const el = document.getElementById("heroRadar");
  const liveCount = pulseBlips.filter((b) => b.live).length;
  renderHomeRadar(el, pulseBlips, newsBlips, `${liveCount} live · ${newsBlips.length ? "latest news on radar" : "scanning"}`);
}

api("/api/events?action=pulse").then((d) => {
  document.getElementById("liveCount").textContent = d.live;
  document.getElementById("pulseLabel").textContent =
    d.live === 1 ? "event live right now" : "events live right now";
  pulseBlips = d.blips || [];
  paintRadar();
}).catch(() => paintRadar());

api("/api/news?action=list").then((d) => {
  newsBlips = (d.articles || []).slice(0, 2).map((a) => ({ title: a.title, slug: a.slug }));
  paintRadar();
}).catch(() => {});

// Recently completed ticker - loops forever, each item is clickable
api("/api/events?action=recent").then((d) => {
  if (!d.events.length) return;
  const items = d.events.map((e) =>
    `<a href="/events" style="text-decoration:none;cursor:pointer">
      <span class="ticker-item" style="cursor:pointer"><b>${esc(e.title)}</b> · ${esc(e.scenario)} · ended ${new Date(e.endedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}${e.peak ? ` · peaked at ${e.peak}` : ""}</span>
    </a>`).join("");
  // Triple the items so it never goes blank - seamless infinite loop
  const ticker = document.getElementById("ticker");
  ticker.innerHTML = items + items + items;
  document.getElementById("tickerWrap").hidden = false;

  // Recalculate animation duration based on content width
  const totalWidth = ticker.scrollWidth;
  const speed = 80; // px per second
  const duration = totalWidth / 3 / speed;
  ticker.style.animationDuration = `${duration}s`;
}).catch(() => {});

// ---- ER:LC community review rail (tilted "glass laptop" screens, slow drift) ----
const REVIEWS = [
  { img: "https://i.postimg.cc/50GXcTbS/Untitled-design-27.webp", server: "New South Wales Roleplay", quote: "Gatherly filled our Friday patrol in minutes — the post-event report is the first thing our command team reads now." },
  { img: "https://i.postimg.cc/dQLNcx8t/image3.webp", server: "Port Macquarie Roleplay", quote: "The health score and funnel showed us exactly where players were dropping off. Our retention is up every single week." },
  { img: "https://i.postimg.cc/jdf8Ln3x/image-4.webp", server: "Australia Roleplay", quote: "Best-time-to-host heatmap alone paid for Ultra. We moved our sessions and peak attendance jumped." },
  { img: "https://i.postimg.cc/kgFfy3ds/image5.webp", server: "Liberty County Patrol", quote: "Verified ER:LC numbers we can actually show staff — no more guessing how an event went." },
  { img: "https://i.postimg.cc/MG6tPP67/image-3.webp", server: "Highway Patrol Division", quote: "Staff intelligence caught our quiet shifts. Response times are sharper than ever." },
  { img: "https://i.postimg.cc/C1d7YRnX/image-2.webp", server: "Metro Emergency RP", quote: "The AI summary reads like a proper debrief. Our hosts love it." },
  { img: "https://i.postimg.cc/tTf5g9hX/image-1.webp", server: "Coastal Roleplay", quote: "Predictive forecasting nailed our next session within five players. Genuinely impressive." },
];
(function buildSpotlight() {
  const host = document.getElementById("spotlightHost");
  if (!host) return;
  const r = { img: "https://i.postimg.cc/7ZMmN8kP/image7.webp", server: "Riverside RP", quote: "Listed in two minutes, full server by start time. The discovery feed just works." };
  host.innerHTML = `
    <div class="spotlight-img"><img src="${esc(r.img)}" alt="${esc(r.server)} in ER:LC" loading="lazy" referrerpolicy="no-referrer"></div>
    <div class="spotlight-body">
      <p class="spotlight-quote">&ldquo;${esc(r.quote)}&rdquo;</p>
      <p class="spotlight-server"><span class="laptop-dot"></span>${esc(r.server)}</p>
    </div>`;
})();

(function buildReviewRail() {
  const track = document.getElementById("reviewTrack");
  if (!track) return;
  const card = (r) => `
    <figure class="laptop-card">
      <div class="laptop">
        <div class="laptop-screen">
          <img src="${esc(r.img)}" alt="${esc(r.server)} in ER:LC" loading="lazy" referrerpolicy="no-referrer">
          <span class="laptop-glare"></span>
        </div>
        <div class="laptop-base"></div>
      </div>
      <figcaption>
        <p class="laptop-quote">&ldquo;${esc(r.quote)}&rdquo;</p>
        <p class="laptop-server"><span class="laptop-dot"></span>${esc(r.server)}</p>
      </figcaption>
    </figure>`;
  // Duplicate the set so the marquee loops seamlessly.
  track.innerHTML = (REVIEWS.map(card).join("") + REVIEWS.map(card).join(""));
  const total = REVIEWS.length;
  track.style.animationDuration = `${total * 9}s`;
})();

// ---- Live events strip on the homepage ----
api("/api/events?action=pulse").then((d) => {
  const grid = document.getElementById("liveEventsGrid");
  if (!grid) return;
  const blips = (d.blips || []).filter((b) => b.live).slice(0, 6);
  const items = blips.length ? blips : (d.blips || []).slice(0, 6);
  if (!items.length) { grid.innerHTML = `<p class="note" style="grid-column:1/-1">No live events this moment — <a href="/advertise">be the first to list one</a>.</p>`; return; }
  grid.innerHTML = items.map((b) => `
    <a class="card live-event-card reveal in" href="/events${b.id ? "#" + esc(b.id) : ""}">
      <div class="row" style="display:flex;justify-content:space-between;align-items:center;gap:10px">
        <b>${esc(b.title || "ER:LC event")}</b>
        <span class="badge ${b.live ? "badge-live" : ""}">${b.live ? "Live" : "Soon"}</span>
      </div>
      <p style="margin-top:8px;font-size:.85rem">${esc(b.scenario || "Roleplay session")}</p>
    </a>`).join("");
}).catch(() => {});

// ---- FAQ accordion ----
document.querySelectorAll(".faq-item").forEach((item) => {
  const q = item.querySelector(".faq-q");
  if (!q) return;
  q.addEventListener("click", () => {
    const wasOpen = item.classList.contains("open");
    document.querySelectorAll(".faq-item.open").forEach((o) => { if (o !== item) o.classList.remove("open"); });
    item.classList.toggle("open", !wasOpen);
  });
});

// admin-editable content blocks
fetch("/api/admin?action=content").then((r) => r.ok ? r.json() : null).then((d) => {
  if (!d || !d.content) return;
  if (d.content.heroHeadline) document.getElementById("heroHeadline").textContent = d.content.heroHeadline;
  if (d.content.heroSub) document.getElementById("heroSub").textContent = d.content.heroSub;
}).catch(() => {});
