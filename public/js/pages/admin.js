import { boot, api, esc, currentUser } from "/js/app.js";
boot("/admin");

const $ = (id) => document.getElementById(id);

let me = null;
let activeTab = "support";
let ticketPollTimer = null;
let openTicketCount = 0;

/* ========================== INIT ========================== */
async function init() {
  try {
    const d = await api("/api/admin?action=whoami");
    me = d;
  } catch {
    document.body.innerHTML = `<div style="padding:40px;text-align:center;color:var(--muted)">Access denied. You need a staff role to view this page. <a href="/">Go home</a></div>`;
    return;
  }

  const roleEl = $("role");
  if (roleEl) roleEl.textContent = `Signed in as ${me.globalName || me.username} - ${me.role === "executive" ? "Executive" : "Admin"}`;

  if (me.role === "executive") {
    document.querySelectorAll(".exec-only").forEach((el) => el.style.removeProperty("display"));
  }

  document.querySelectorAll(".cr-tab").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  switchTab("checklist");
}

/* ========================== TABS ========================== */
function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll(".cr-tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  // NOTE: panels are display:none in CSS. Setting inline display to "" would fall
  // back to that CSS rule and stay hidden — so the active panel must be "block".
  document.querySelectorAll(".cr-panel").forEach((p) => p.style.display = p.dataset.panel === tab ? "block" : "none");
  clearInterval(ticketPollTimer);
  if (tab === "checklist") { loadChecklist(); ticketPollTimer = setInterval(loadChecklist, 15000); }
  if (tab === "support") { loadTickets(); ticketPollTimer = setInterval(loadTickets, 4000); }
  if (tab === "ads") loadAds();
  if (tab === "news") loadNews();
  if (tab === "users") loadUsers();
  if (tab === "events") loadEvents();
  if (tab === "announcements") loadAnnouncements();
  if (tab === "notifications") { /* form only */ }
  if (tab === "executive" && me.role === "executive") loadExec();
  if (tab === "audit") loadAudit();
}

/* ========================== ADS ========================== */
async function loadAds() {
  const host = $("adsList");
  if (!host) return;
  host.innerHTML = `<p style="color:var(--muted)">Loading&hellip;</p>`;
  try {
    const d = await api("/api/ads?action=all");
    const ads = d.ads || [];
    const pending = ads.filter((a) => a.status === "pending").length;
    const badge = $("adsBadge");
    if (badge) { badge.textContent = pending || ""; badge.style.display = pending ? "" : "none"; }
    if (!ads.length) { host.innerHTML = `<p style="color:var(--muted)">No advertisements submitted yet.</p>`; return; }
    host.innerHTML = ads.map((a) => {
      const flagged = a.scan?.flagged;
      const color = a.status === "active" ? "var(--good,#69d99c)" : a.status === "denied" ? "var(--bad,#ff7a7a)" : flagged ? "var(--live,#ffb454)" : "var(--signal)";
      return `<div class="card" style="margin-bottom:10px;border-left:3px solid ${color}">
        <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start">
          <div style="min-width:0;flex:1">
            <strong>${esc(a.title)}</strong>
            <div style="font-size:.78rem;color:var(--muted);margin-top:2px">by ${esc(a.username)} · ${a.days}d · ${a.paid ? "paid" : "<span style='color:var(--live,#ffb454)'>unpaid</span>"} · ${esc(a.status)}</div>
            <div style="font-size:.78rem;margin-top:4px"><a href="${esc(a.link)}" target="_blank" rel="noopener nofollow">${esc(a.link)}</a></div>
            ${flagged ? `<div style="font-size:.78rem;color:var(--live,#ffb454);margin-top:6px"><b>Watchdog:</b> ${esc(a.scan.reasons.join(" "))}</div>` : ""}
            ${a.denyReason ? `<div style="font-size:.78rem;color:var(--bad,#ff7a7a);margin-top:6px">Denied: ${esc(a.denyReason)}</div>` : ""}
            <div style="font-size:.74rem;color:var(--faint);margin-top:6px">Impressions ${a.impressions || 0} · Clicks ${a.clicks || 0}</div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${a.status === "pending" ? `<button class="btn btn-ghost btn-sm" onclick="approveAd('${esc(a.id)}')">Approve</button>` : ""}
            ${a.status !== "denied" ? `<button class="btn btn-ghost btn-sm" onclick="denyAd('${esc(a.id)}')">Deny</button>` : ""}
          </div>
        </div>
      </div>`;
    }).join("");
    // Load current config into the form.
    const c = (await api("/api/ads?action=active")).config;
    if ($("adRotateSec")) $("adRotateSec").value = c.rotateSec;
    if ($("adHouseWeight")) $("adHouseWeight").value = c.houseWeight;
    if ($("adAdvWeight")) $("adAdvWeight").value = c.advertiserWeight;
  } catch (e) { host.innerHTML = `<p style="color:var(--bad,#ff7a7a)">${esc(e.message)}</p>`; }
}
window.approveAd = async (id) => { try { await api("/api/ads?action=approve", { method: "POST", body: { id } }); loadAds(); } catch (e) { alert(e.message); } };
window.denyAd = async (id) => { const reason = prompt("Reason for denial:"); if (!reason) return; try { await api("/api/ads?action=deny", { method: "POST", body: { id, reason } }); loadAds(); } catch (e) { alert(e.message); } };
window.saveAdConfig = async () => {
  const msg = $("adCfgMsg");
  try {
    await api("/api/ads?action=config", { method: "POST", body: { rotateSec: +$("adRotateSec").value, houseWeight: +$("adHouseWeight").value, advertiserWeight: +$("adAdvWeight").value } });
    if (msg) msg.innerHTML = `<div class="alert alert-ok">Rotation saved.</div>`;
  } catch (e) { if (msg) msg.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; }
};

/* ========================== NEWS ========================== */
async function loadNews() {
  const host = $("newsList");
  if (!host) return;
  host.innerHTML = `<p style="color:var(--muted)">Loading&hellip;</p>`;
  try {
    const { articles } = await api("/api/news?action=admin-list");
    if (!articles.length) { host.innerHTML = `<p style="color:var(--muted)">No articles yet. Click "New article" to get started.</p>`; return; }
    host.innerHTML = articles.map((a) => `
      <div class="card" style="margin-bottom:8px;cursor:pointer" onclick="editNews('${esc(a.id)}')">
        <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center">
          <div style="min-width:0">
            <strong>${esc(a.title)}</strong>
            <div style="font-size:.78rem;color:var(--muted);margin-top:2px">${esc(a.authorName || "Gatherly")} · ${a.published ? "Published" : "Draft"} · ${new Date(a.updatedAt).toLocaleString()}</div>
          </div>
          <span class="badge ${a.published ? "badge-good" : ""}">${a.published ? "Live" : "Draft"}</span>
        </div>
      </div>`).join("");
  } catch (e) { host.innerHTML = `<p style="color:var(--bad,#ff7a7a)">${esc(e.message)}</p>`; }
}

window.newArticle = () => {
  ["newsId", "newsTitleInput", "newsAuthor", "newsAvatar", "newsBanner", "newsExcerpt", "newsBlocks"].forEach((k) => { if ($(k)) $(k).value = ""; });
  if ($("newsPublished")) $("newsPublished").checked = false;
};

window.editNews = async (id) => {
  try {
    const { articles } = await api("/api/news?action=admin-list");
    const a = articles.find((x) => x.id === id);
    if (!a) return;
    $("newsId").value = a.id;
    $("newsTitleInput").value = a.title || "";
    $("newsAuthor").value = a.authorName || "";
    $("newsAvatar").value = a.authorAvatar || "";
    $("newsBanner").value = a.banner || "";
    $("newsExcerpt").value = a.excerpt || "";
    $("newsBlocks").value = (a.blocks || []).map((b) => b.type === "image" ? `img
