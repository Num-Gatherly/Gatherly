import { boot, api, renderRadar, esc } from "/js/app.js";
boot("/");

// live pulse + radar blips with scroll-driven parallax
let radarBlips = [];
api("/api/events?action=pulse").then((d) => {
  document.getElementById("liveCount").textContent = d.live;
  document.getElementById("pulseLabel").textContent =
    d.live === 1 ? "event live right now" : "events live right now";
  radarBlips = d.blips;
  renderRadar(document.getElementById("heroRadar"), d.blips, `${d.live} live · ${d.upcoming} upcoming`);
}).catch(() => renderRadar(document.getElementById("heroRadar"), [], "scanning"));

// Scroll-driven radar transform (Apple-style: radar zooms, tilts, and gains depth as you scroll)
const radarEl = document.getElementById("heroRadar");
if (radarEl) {
  let ticking = false;
  window.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const scrollY = window.scrollY;
      const heroHeight = document.querySelector(".hero")?.offsetHeight || 600;
      const progress = Math.min(scrollY / heroHeight, 1);
      const scale = 1 + progress * 0.18;
      const rotX = progress * 12;
      const rotZ = progress * -6;
      const opacity = 1 - progress * 0.4;
      const blur = progress * 3;
      radarEl.style.transform = `scale(${scale}) perspective(700px) rotateX(${rotX}deg) rotateZ(${rotZ}deg)`;
      radarEl.style.opacity = opacity;
      radarEl.style.filter = `blur(${blur}px)`;
      // blips pulse faster as you scroll
      const sweepEl = radarEl.querySelector(".radar-sweep");
      if (sweepEl) {
        const duration = Math.max(1.5, 4.5 - progress * 3);
        sweepEl.style.animationDuration = `${duration}s`;
      }
      ticking = false;
    });
  }, { passive: true });
}

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
  { img: "https://i.postimg.cc/7ZMmN8kP/image7.webp", server: "Riverside RP", quote: "Listed in two minutes, full server by start time. The discovery feed just works." },
  { img: "https://i.postimg.cc/MG6tPP67/image-3.webp", server: "Highway Patrol Division", quote: "Staff intelligence caught our quiet shifts. Response times are sharper than ever." },
  { img: "https://i.postimg.cc/C1d7YRnX/image-2.webp", server: "Metro Emergency RP", quote: "The AI summary reads like a proper debrief. Our hosts love it." },
  { img: "https://i.postimg.cc/tTf5g9hX/image-1.webp", server: "Coastal Roleplay", quote: "Predictive forecasting nailed our next session within five players. Genuinely impressive." },
];
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

// admin-editable content blocks
fetch("/api/admin?action=content").then((r) => r.ok ? r.json() : null).then((d) => {
  if (!d || !d.content) return;
  if (d.content.heroHeadline) document.getElementById("heroHeadline").textContent = d.content.heroHeadline;
  if (d.content.heroSub) document.getElementById("heroSub").textContent = d.content.heroSub;
}).catch(() => {});
