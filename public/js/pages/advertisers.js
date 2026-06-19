import { boot, api, esc, currentUser } from "/js/app.js";
boot("/advertisers");

const $ = (id) => document.getElementById(id);
const PACKS = [
  { days: 3, price: "$5", note: "Try it out" },
  { days: 7, price: "$10", note: "Most popular", popular: true },
  { days: 14, price: "$18", note: "Best value" },
];
let chosen = 7;
let adImageUrl = null;

const adDz = $("adDz"), adDzInput = $("adDzInput");
adDz.addEventListener("click", () => adDzInput.click());
adDz.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") adDzInput.click(); });
["dragover", "dragenter"].forEach((t) => adDz.addEventListener(t, (e) => { e.preventDefault(); adDz.classList.add("drag"); }));
["dragleave", "drop"].forEach((t) => adDz.addEventListener(t, (e) => { e.preventDefault(); adDz.classList.remove("drag"); }));
adDz.addEventListener("drop", (e) => handleAdBanner(e.dataTransfer.files[0]));
adDzInput.addEventListener("change", () => handleAdBanner(adDzInput.files[0]));

async function handleAdBanner(file) {
  const msg = $("adMsg");
  if (!file) return;
  if (!currentUser()) { msg.innerHTML = `<div class="alert alert-err">Log in first to upload a banner. <a href="/api/auth?action=start">Continue with Discord</a></div>`; return; }
  if (file.size > 2 * 1024 * 1024) { msg.innerHTML = `<div class="alert alert-err">Banner must be under 2MB.</div>`; return; }
  const okDims = await new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img.naturalWidth === 960 && img.naturalHeight === 600);
    img.onerror = () => res(false);
    img.src = URL.createObjectURL(file);
  });
  if (!okDims) { msg.innerHTML = `<div class="alert alert-err">Banner must be exactly 960x600px. Resize it and try again.</div>`; return; }
  $("adDzText").textContent = "Uploading…";
  try {
    const r = await fetch("/api/image?kind=ad", { method: "POST", body: file, credentials: "same-origin" });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Upload failed.");
    adImageUrl = location.origin + d.url;
    adDz.innerHTML = `<span>Banner attached - click to replace</span><img src="${d.url}" alt="Ad banner preview">`;
    adDz.appendChild(adDzInput);
  } catch (e) {
    $("adDzText").textContent = "Drag a 960x600 banner here, or click to choose a file";
    msg.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`;
  }
}

function renderPacks() {
  $("adPacks").innerHTML = PACKS.map((p) => `
    <div class="adv-price ${p.days === chosen ? "active" : ""}" data-days="${p.days}">
      <b>${p.price}</b>
      <div style="font-size:.92rem;font-weight:600">${p.days} days</div>
      <div style="font-size:.76rem;color:var(--muted)">${esc(p.note)}</div>
    </div>`).join("");
  $("adPacks").querySelectorAll(".adv-price").forEach((el) => el.onclick = () => { chosen = +el.dataset.days; renderPacks(); });
}
renderPacks();

$("adBuy").onclick = async () => {
  const msg = $("adMsg");
  if (!currentUser()) { msg.innerHTML = `<div class="alert alert-err">Log in first. <a href="/api/auth?action=start">Continue with Discord</a></div>`; return; }
  const title = $("adTitle").value.trim();
  const link = $("adLink").value.trim();
  const image = adImageUrl;
  if (!title || !link) { msg.innerHTML = `<div class="alert alert-err">Add a headline and destination link.</div>`; return; }
  msg.innerHTML = `<div class="alert alert-ok">Scanning your ad and opening checkout&hellip;</div>`;
  try {
    const d = await api("/api/ads?action=submit", { method: "POST", body: { title, link, image, days: chosen } });
    if (d.url) { location.href = d.url; return; }
    msg.innerHTML = `<div class="alert alert-ok">${esc(d.note || "Submitted for review.")}</div>`;
    loadDashboard();
  } catch (e) { msg.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; }
};

const STATUS_LABEL = { pending: "In review", active: "Running", denied: "Denied", expired: "Ended" };
const STATUS_COLOR = { pending: "var(--live,#ffb454)", active: "var(--good,#69d99c)", denied: "var(--bad,#ff7a7a)", expired: "var(--muted)" };

async function loadDashboard() {
  const host = $("adDashboard");
  if (!currentUser()) { host.innerHTML = `<p class="note">Log in to see your advertisements.</p>`; return; }
  try {
    const { ads } = await api("/api/ads?action=mine");
    if (!ads.length) { host.innerHTML = `<p class="note">No advertisements yet. Book one above to get started.</p>`; return; }
    host.innerHTML = ads.map((a) => {
      const paid = !a.paid && a.status === "pending";
      return `<div class="card" style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center">
        <div style="min-width:0"><strong>${esc(a.title)}</strong>
          <div style="font-size:.8rem;color:var(--muted)">${esc(a.link)}</div></div>
        <span class="badge" style="color:${STATUS_COLOR[a.status] || "var(--muted)"};border-color:${STATUS_COLOR[a.status] || "var(--muted)"}">${paid ? "Awaiting payment" : (STATUS_LABEL[a.status] || a.status)}</span>
      </div>
      ${a.denyReason ? `<p class="note" style="border-left-color:var(--bad,#ff7a7a)">Denied: ${esc(a.denyReason)}</p>` : ""}
      <div class="grid grid-4" style="margin-top:14px">
        <div class="stat"><b>${a.impressions}</b><span>Impressions</span></div>
        <div class="stat"><b>${a.clicks}</b><span>Clicks</span></div>
        <div class="stat"><b>${a.uniqueClicks}</b><span>Unique visitors</span></div>
        <div class="stat"><b>${a.ctr}%</b><span>Click-through rate</span></div>
      </div>
      ${a.startAt ? `<p class="note" style="margin-top:10px">Running ${new Date(a.startAt).toLocaleDateString()} &rarr; ${new Date(a.endAt).toLocaleDateString()} · ${a.days}-day booking</p>` : ""}
      ${a.clickers && a.clickers.length ? `<p class="note">Recent signed-in visitors: ${a.clickers.map(esc).join(", ")}</p>` : ""}
    </div>`;
    }).join("");
  } catch (e) { host.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; }
}

// currentUser populates slightly after boot(); poll briefly so the dashboard fills in.
let tries = 0;
const t = setInterval(() => { if (currentUser() || tries++ > 12) { clearInterval(t); loadDashboard(); } }, 250);
loadDashboard();
