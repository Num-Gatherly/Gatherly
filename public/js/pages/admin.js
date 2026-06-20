import { boot, api, esc, currentUser } from "/js/app.js";
boot("/admin");

const $ = (id) => document.getElementById(id);

// Inline onerror="" attributes are blocked by the site's CSP, so broken
// avatar/ad images are wired up after render instead.
function wireImgFallback(host) {
  if (!host) return;
  host.querySelectorAll("img.js-img-fallback").forEach((img) => {
    img.addEventListener("error", () => { img.style.display = "none"; }, { once: true });
  });
}

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
    document.querySelectorAll(".exec-only").forEach((el) => el.classList.remove("exec-only"));
  } else {
    const execBox = $("execClaimBox");
    if (execBox) execBox.style.display = "block";
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
  if (tab === "broadcast") loadBroadcastRuns();
  if (tab === "tests") loadThanksContent();
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
            ${a.status === "pending" ? `<button class="btn btn-ghost btn-sm" data-action="approve-ad" data-id="${esc(a.id)}">Approve</button>` : ""}
            ${a.status !== "denied" ? `<button class="btn btn-ghost btn-sm" data-action="deny-ad" data-id="${esc(a.id)}">Deny</button>` : ""}
          </div>
        </div>
      </div>`;
    }).join("");
    const c = (await api("/api/ads?action=active")).config;
    if ($("adRotateSec")) $("adRotateSec").value = c.rotateSec;
    if ($("adHouseWeight")) $("adHouseWeight").value = c.houseWeight;
    if ($("adAdvWeight")) $("adAdvWeight").value = c.advertiserWeight;
    loadHouseAds();
  } catch (e) { host.innerHTML = `<p style="color:var(--bad,#ff7a7a)">${esc(e.message)}</p>`; }
}
async function approveAd(id) { try { await api("/api/ads?action=approve", { method: "POST", body: { id } }); loadAds(); } catch (e) { alert(e.message); } };
async function denyAd(id) { const reason = prompt("Reason for denial:"); if (!reason) return; try { await api("/api/ads?action=deny", { method: "POST", body: { id, reason } }); loadAds(); } catch (e) { alert(e.message); } };
async function saveAdConfig() {
  const msg = $("adCfgMsg");
  try {
    await api("/api/ads?action=config", { method: "POST", body: { rotateSec: +$("adRotateSec").value, houseWeight: +$("adHouseWeight").value, advertiserWeight: +$("adAdvWeight").value } });
    if (msg) msg.innerHTML = `<div class="alert alert-ok">Rotation saved.</div>`;
  } catch (e) { if (msg) msg.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; }
};

/* ---- House ads (Gatherly + ASB) ---- */
let houseAdsCache = [];
async function loadHouseAds() {
  const host = $("houseAdList");
  if (!host) return;
  host.innerHTML = `<p style="color:var(--muted)">Loading&hellip;</p>`;
  try {
    const d = await api("/api/admin?action=house-ads");
    const ads = d.houseAds || [];
    houseAdsCache = ads;
    if (!ads.length) { host.innerHTML = `<p style="color:var(--muted)">No house ads yet. Add one on the right.</p>`; return; }
    host.innerHTML = ads.map((a) => {
      const kindLabel = a.kind === "asb" ? "ASB Advertising" : "Gatherly";
      const off = a.enabled === false;
      return `<div class="house-ad-card${off ? " off" : ""}">
        <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:flex-start">
          <div style="flex:1;min-width:0">
            <span class="badge ${a.kind === "asb" ? "" : "badge-good"}">${esc(kindLabel)}</span>
            <strong style="display:block;margin-top:6px">${esc(a.title || "Untitled")}</strong>
            ${a.subtitle ? `<div style="font-size:.82rem;color:var(--muted);margin-top:2px">${esc(a.subtitle)}</div>` : ""}
            ${a.link ? `<div style="font-size:.78rem;margin-top:4px"><a href="${esc(a.link)}" target="_blank" rel="noopener nofollow">${esc(a.link)}</a></div>` : ""}
            ${a.image ? `<img src="${esc(a.image)}" alt="" class="js-img-fallback">` : ""}
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="btn btn-ghost btn-sm" data-action="edit-house-ad" data-id="${esc(a.id)}">Edit</button>
            <button class="btn btn-ghost btn-sm" data-action="toggle-house-ad" data-id="${esc(a.id)}" data-off="${off}">${off ? "Enable" : "Disable"}</button>
            <button class="btn btn-sm" style="background:var(--bad,#ff7a7a);color:#fff" data-action="delete-house-ad" data-id="${esc(a.id)}">Delete</button>
          </div>
        </div>
      </div>`;
    }).join("");
    wireImgFallback(host);
  } catch (e) { host.innerHTML = `<p style="color:var(--bad,#ff7a7a)">${esc(e.message)}</p>`; }
}

function clearHouseAd() {
  ["houseAdId", "houseAdTitle", "houseAdSubtitle", "houseAdImage", "houseAdLink"].forEach((k) => { if ($(k)) $(k).value = ""; });
  if ($("houseAdKind")) $("houseAdKind").value = "gatherly";
  if ($("houseAdEnabled")) $("houseAdEnabled").checked = true;
  if ($("houseAdFormTitle")) $("houseAdFormTitle").textContent = "Add house ad";
  const msg = $("houseAdMsg"); if (msg) msg.innerHTML = "";
};

function editHouseAd(adId) {
  const a = houseAdsCache.find((x) => x.id === adId);
  if (!a) return;
  if ($("houseAdId")) $("houseAdId").value = a.id || "";
  if ($("houseAdKind")) $("houseAdKind").value = a.kind === "asb" ? "asb" : "gatherly";
  if ($("houseAdTitle")) $("houseAdTitle").value = a.title || "";
  if ($("houseAdSubtitle")) $("houseAdSubtitle").value = a.subtitle || "";
  if ($("houseAdImage")) $("houseAdImage").value = a.image || "";
  if ($("houseAdLink")) $("houseAdLink").value = a.link || "";
  if ($("houseAdEnabled")) $("houseAdEnabled").checked = a.enabled !== false;
  if ($("houseAdFormTitle")) $("houseAdFormTitle").textContent = "Edit house ad";
  const msg = $("houseAdMsg"); if (msg) msg.innerHTML = "";
};

async function saveHouseAd() {
  const msg = $("houseAdMsg");
  const body = {
    id: $("houseAdId")?.value || undefined,
    kind: $("houseAdKind")?.value || "gatherly",
    title: $("houseAdTitle")?.value?.trim(),
    subtitle: $("houseAdSubtitle")?.value?.trim(),
    image: $("houseAdImage")?.value?.trim(),
    link: $("houseAdLink")?.value?.trim(),
    enabled: $("houseAdEnabled")?.checked,
  };
  if (!body.title) { if (msg) msg.innerHTML = `<div class="alert alert-err">A title is required.</div>`; return; }
  try {
    await api("/api/admin?action=house-ad-save", { method: "POST", body });
    if (msg) msg.innerHTML = `<div class="alert alert-ok">House ad saved.</div>`;
    clearHouseAd();
    loadHouseAds();
  } catch (e) { if (msg) msg.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; }
};

async function toggleHouseAd(id, currentlyOff) {
  try {
    await api("/api/admin?action=house-ad-save", { method: "POST", body: { id, enabled: currentlyOff } });
    loadHouseAds();
  } catch (e) { alert(e.message); }
};

async function deleteHouseAd(id) {
  if (!confirm("Delete this house ad? This cannot be undone.")) return;
  try {
    await api("/api/admin?action=house-ad-delete", { method: "POST", body: { id } });
    loadHouseAds();
  } catch (e) { alert(e.message); }
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
      <div class="card" style="margin-bottom:8px;cursor:pointer" data-action="edit-news" data-id="${esc(a.id)}">
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

function newArticle() {
  ["newsId", "newsTitleInput", "newsAuthor", "newsAvatar", "newsBanner", "newsExcerpt", "newsBlocks"].forEach((k) => { if ($(k)) $(k).value = ""; });
  if ($("newsBody")) $("newsBody").innerHTML = "";
  if ($("newsPublished")) $("newsPublished").checked = false;
  const msg = $("newsMsg"); if (msg) msg.innerHTML = "";
};

async function editNews(id) {
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
    $("newsBody").innerHTML = blocksToHtml(a.blocks || []);
    $("newsPublished").checked = Boolean(a.published);
    const msg = $("newsMsg"); if (msg) msg.innerHTML = "";
  } catch (e) { alert(e.message); }
};

// Rebuild editor HTML from stored blocks (handles legacy text/heading/image blocks too).
function blocksToHtml(blocks) {
  return blocks.map((b) => {
    if (b.type === "html") return b.value;
    if (b.type === "image") return `<img src="${esc(b.value)}" alt="">`;
    if (b.type === "heading") return `<h2>${esc(b.value)}</h2>`;
    return `<p>${esc(b.value).replace(/\n/g, "<br>")}</p>`;
  }).join("");
}

async function saveNews() {
  const msg = $("newsMsg");
  const html = ($("newsBody")?.innerHTML || "").trim();
  const blocks = html ? [{ type: "html", value: html }] : [];
  const body = {
    id: $("newsId").value || undefined,
    title: $("newsTitleInput").value.trim(),
    authorName: $("newsAuthor").value.trim(),
    authorAvatar: $("newsAvatar").value.trim(),
    banner: $("newsBanner").value.trim(),
    excerpt: $("newsExcerpt").value.trim(),
    blocks,
    published: $("newsPublished").checked,
  };
  if (!body.title) { if (msg) msg.innerHTML = `<div class="alert alert-err">Title is required.</div>`; return; }
  try {
    const { article } = await api("/api/news?action=save", { method: "POST", body });
    $("newsId").value = article.id;
    if (msg) msg.innerHTML = `<div class="alert alert-ok">${body.published ? "Saved and published" : "Saved as draft"}.</div>`;
    loadNews();
  } catch (e) { if (msg) msg.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; }
};

async function deleteNews() {
  const id = $("newsId").value;
  if (!id) return;
  if (!confirm("Delete this article? This cannot be undone.")) return;
  try {
    await api("/api/news?action=delete", { method: "POST", body: { id } });
    newArticle(); loadNews();
  } catch (e) { alert(e.message); }
};

/* ========================== CHECKLIST ========================== */
const sevColor = (s) => (s === "high" ? "var(--bad,#ff7a7a)" : s === "warn" ? "var(--live,#ffb454)" : "var(--good,#69d99c)");
async function loadChecklist() {
  try {
    const d = await api("/api/admin?action=checklist");
    const t = $("checklistTime");
    if (t) t.textContent = `Last swept ${new Date(d.generatedAt).toLocaleTimeString()}`;

    const badge = $("checklistBadge");
    if (badge) { badge.textContent = d.pending || ""; badge.style.display = d.pending ? "" : "none"; }

    const sum = $("checklistSummary");
    if (sum) sum.innerHTML = (d.checklist || []).map((c) => `
      <div class="stat" style="border-left:3px solid ${sevColor(c.severity)}">
        <b>${c.count}</b><span>${esc(c.label)}</span>
      </div>`).join("");

    const flags = $("checklistFlags");
    if (flags) flags.innerHTML = (d.flags || []).length ? d.flags.map((f) => `
      <div class="card" style="margin-bottom:8px;border-left:3px solid var(--bad,#ff7a7a)">
        <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:flex-start">
          <div style="flex:1;min-width:0">
            <strong>${esc(f.action.replace("watchdog.", ""))}</strong>
            <div style="font-size:.82rem;color:var(--muted);margin-top:2px">${esc(f.what)}</div>
            ${f.risk ? `<div style="font-size:.8rem;color:var(--live,#ffb454);margin-top:2px">${esc(f.risk)}</div>` : ""}
            <div style="font-size:.74rem;color:var(--faint);margin-top:4px">${esc(f.actor)} · ${new Date(f.at).toLocaleString()}</div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="btn btn-ghost btn-sm" data-action="resolve-flag" data-key="${esc(f.key)}">Resolve</button>
            <button class="btn btn-ghost btn-sm" data-action="escalate-flag" data-key="${esc(f.key)}">Escalate</button>
          </div>
        </div>
      </div>`).join("") : `<p style="color:var(--muted)">No security flags this week. All clear.</p>`;

    const tk = $("checklistTickets");
    if (tk) tk.innerHTML = (d.tickets || []).length ? d.tickets.map((t) => `
      <div class="card" style="margin-bottom:8px;display:flex;align-items:center;gap:12px;cursor:pointer" data-action="goto-support">
        <span style="width:8px;height:8px;border-radius:50%;background:${t.escalated ? "var(--bad,#ff7a7a)" : t.assignedTo ? "var(--good,#69d99c)" : "var(--live,#ffb454)"};flex-shrink:0"></span>
        <div style="flex:1;min-width:0"><strong>${esc(t.subject || "No subject")}</strong>
          <div style="font-size:.8rem;color:var(--muted)">${esc(t.username)} ${t.escalated ? "· escalated" : t.assignedTo ? "· claimed" : "· unclaimed"}</div>
        </div>
        <span style="font-size:.8rem;color:var(--signal)">Open &rarr;</span>
      </div>`).join("") : `<p style="color:var(--muted)">No open tickets.</p>`;
  } catch (e) {
    const flags = $("checklistFlags");
    if (flags) flags.innerHTML = `<p style="color:var(--bad,#ff7a7a)">${esc(e.message)}</p>`;
  }
}

async function resolveFlag(key, btn) {
  try { await api("/api/admin?action=resolve-flag", { method: "POST", body: { key } }); if (btn) btn.closest(".card").style.opacity = ".4"; loadChecklist(); }
  catch (e) { alert(e.message); }
};
async function escalateFlag(key, btn) {
  try { await api("/api/admin?action=escalate-flag", { method: "POST", body: { key } }); if (btn) { btn.textContent = "Escalated"; btn.disabled = true; } }
  catch (e) { alert(e.message); }
};

/* ========================== SUPPORT ========================== */
async function loadTickets() {
  try {
    const d = await api("/api/tickets?action=list");
    const tickets = d.tickets || [];
    openTicketCount = tickets.filter((t) => t.status !== "closed").length;
    const badge = $("supportBadge");
    if (badge) { badge.textContent = openTicketCount || ""; badge.style.display = openTicketCount ? "" : "none"; }
    renderTickets(tickets);
  } catch {}
}

function renderTickets(tickets) {
  const host = $("ticketList");
  if (!host) return;
  if (!tickets.length) { host.innerHTML = `<p style="color:var(--muted)">No tickets yet.</p>`; return; }
  host.innerHTML = tickets.map((t) => {
    const statusColor = t.status === "closed" ? "var(--muted)" : t.escalated ? "var(--yellow,#ffcf5c)" : t.assignedTo ? "var(--green,#69d99c)" : "var(--red,#ff7a7a)";
    const statusLabel = t.status === "closed" ? "Closed" : t.escalated ? "Escalated" : t.assignedTo ? "Claimed" : "Open";
    return `<div class="card ticket-row" data-id="${esc(t.id)}" style="margin-bottom:10px;cursor:pointer;border-left:3px solid ${statusColor}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
        <div>
          <strong>${esc(t.subject || "No subject")}</strong>
          <div style="font-size:.8rem;color:var(--muted);margin-top:2px">${esc(t.username)} - ${esc(t.topic)} - ${esc(t.plan || "free")}</div>
        </div>
        <span style="font-size:.78rem;color:${statusColor};white-space:nowrap">${statusLabel}</span>
      </div>
    </div>`;
  }).join("");
  host.querySelectorAll(".ticket-row").forEach((row) => {
    row.addEventListener("click", () => openTicket(row.dataset.id, tickets.find((t) => t.id === row.dataset.id)));
  });
}

function openTicket(id, t) {
  const host = $("ticketDetail");
  if (!host || !t) return;
  const msgs = (t.messages || []).map((m) => `
    <div style="margin-bottom:10px;padding:10px 12px;background:${m.from === "staff" ? "var(--surface2,rgba(255,255,255,.06))" : "var(--surface)"};border-radius:8px">
      <div style="font-size:.75rem;color:var(--muted);margin-bottom:4px">${m.from === "staff" ? "Staff" : esc(t.username)} - ${new Date(m.at).toLocaleString()}</div>
      <div>${esc(m.text)}</div>
    </div>`).join("");
  const claimLabel = t.assignedTo
    ? `Claimed by ${esc(t.assignedToName || "staff")}${me && t.assignedTo === me.id ? " (you)" : ""}`
    : "Unclaimed";
  host.innerHTML = `
    <div class="card" style="margin-top:16px">
      <h3 style="margin-bottom:4px">${esc(t.subject)}</h3>
      <div style="font-size:.82rem;color:var(--muted);margin-bottom:6px">${esc(t.username)} - ${esc(t.topic)} - Ticket <code>${esc(t.id)}</code></div>
      <div style="font-size:.8rem;color:${t.assignedTo ? "var(--good,#69d99c)" : "var(--live,#ffb454)"};margin-bottom:14px">${esc(claimLabel)}</div>
      <div style="max-height:340px;overflow-y:auto;margin-bottom:14px">${msgs || "<p style='color:var(--muted)'>No messages.</p>"}</div>
      <textarea id="staffReply" class="input" rows="3" placeholder="Type your reply..." style="width:100%;margin-bottom:10px"></textarea>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary btn-sm" data-action="send-staff-reply" data-id="${esc(id)}">Send reply</button>
        ${t.assignedTo
          ? `<button class="btn btn-ghost btn-sm" data-action="unclaim-ticket" data-id="${esc(id)}">Unclaim</button>`
          : `<button class="btn btn-ghost btn-sm" data-action="claim-ticket" data-id="${esc(id)}">Claim</button>`}
        <button class="btn btn-sm" style="background:var(--bad,#ff7a7a);color:#fff" data-action="close-ticket" data-id="${esc(id)}">Close ticket</button>
      </div>
      <div id="ticketMsg" style="margin-top:10px"></div>
    </div>`;
}

async function refreshOpenTicket(id) {
  try {
    const { ticket } = await api(`/api/tickets?action=get&id=${encodeURIComponent(id)}`);
    openTicket(id, ticket);
  } catch {}
  loadTickets();
}

async function claimTicket(id) {
  try {
    await api(`/api/tickets?action=assign&id=${encodeURIComponent(id)}`, { method: "POST" });
    await refreshOpenTicket(id);
  } catch (e) { alert(e.message); }
};

async function unclaimTicket(id) {
  try {
    await api(`/api/tickets?action=unassign&id=${encodeURIComponent(id)}`, { method: "POST" });
    await refreshOpenTicket(id);
  } catch (e) { alert(e.message); }
};

async function sendStaffReply(id) {
  const text = $("staffReply")?.value?.trim();
  const msg = $("ticketMsg");
  if (!text) { if (msg) msg.innerHTML = `<div class="alert alert-err">Enter a reply first.</div>`; return; }
  try {
    await api(`/api/tickets?action=reply&id=${encodeURIComponent(id)}`, { method: "POST", body: { text } });
    if (msg) msg.innerHTML = `<div class="alert alert-ok">Reply sent.</div>`;
    if ($("staffReply")) $("staffReply").value = "";
    loadTickets();
  } catch (e) { if (msg) msg.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; }
};

async function closeTicket(id) {
  const msg = $("ticketMsg");
  try {
    await api(`/api/tickets?action=close&id=${encodeURIComponent(id)}`, { method: "POST" });
    if (msg) msg.innerHTML = `<div class="alert alert-ok">Ticket closed.</div>`;
    loadTickets();
    const host = $("ticketDetail");
    if (host) host.innerHTML = "";
  } catch (e) { if (msg) msg.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; }
};

/* ========================== USERS ========================== */
async function loadUsers(q = "") {
  const host = $("userList");
  if (!host) return;
  host.innerHTML = `<p style="color:var(--muted)">Loading...</p>`;
  try {
    const d = await api(`/api/admin?action=users-search&q=${encodeURIComponent(q)}`);
    const users = d.users || [];
    if (!users.length) { host.innerHTML = `<p style="color:var(--muted)">No users found.</p>`; return; }
    host.innerHTML = users.map((u) => `
      <div class="card user-row" data-id="${esc(u.id)}" style="margin-bottom:8px;cursor:pointer;display:flex;align-items:center;gap:12px">
        ${u.avatar && u.discordId ? `<img src="https://cdn.discordapp.com/avatars/${esc(u.discordId)}/${esc(u.avatar)}.png?size=64" style="width:36px;height:36px;border-radius:50%;flex-shrink:0" class="js-img-fallback">` : `<span style="width:36px;height:36px;border-radius:50%;background:var(--signal-deep);display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;flex-shrink:0">${esc((u.username || "?")[0].toUpperCase())}</span>`}
        <div style="flex:1;min-width:0">
          <strong>${esc(u.username)}</strong>
          ${u.globalName && u.globalName !== u.username ? `<span style="color:var(--muted);font-size:.82rem"> (${esc(u.globalName)})</span>` : ""}
          <div style="font-size:.78rem;color:var(--muted)">${esc(u.plan)} ${u.role ? "- " + esc(u.role) : ""} ${u.suspended ? "- SUSPENDED" : ""}</div>
        </div>
        <span style="font-size:.8rem;color:var(--muted)">${u.credits} credits</span>
      </div>`).join("");
    wireImgFallback(host);
    host.querySelectorAll(".user-row").forEach((row) => {
      row.addEventListener("click", () => openUser(row.dataset.id, users.find((u) => u.id === row.dataset.id)));
    });
  } catch (e) { host.innerHTML = `<p style="color:var(--red,#ff7a7a)">${esc(e.message)}</p>`; }
}

function openUser(id, u) {
  const host = $("userDetail");
  if (!host || !u) return;
  const isExec = me.role === "executive";
  const avatarHtml = u.avatar && u.discordId
    ? `<img src="https://cdn.discordapp.com/avatars/${esc(u.discordId)}/${esc(u.avatar)}.png?size=128" style="width:52px;height:52px;border-radius:50%" class="js-img-fallback">`
    : `<span style="width:52px;height:52px;border-radius:50%;background:var(--signal-deep);display:flex;align-items:center;justify-content:center;font-size:1.2rem;font-weight:700;color:#fff">${esc((u.username || "?")[0].toUpperCase())}</span>`;

  host.innerHTML = `
    <div class="card" style="margin-top:16px">
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px">
        ${avatarHtml}
        <div>
          <h3 style="margin:0">${esc(u.username)}</h3>
          ${u.globalName && u.globalName !== u.username ? `<div style="color:var(--muted);font-size:.88rem">Display name: ${esc(u.globalName)}</div>` : ""}
          <div style="font-size:.82rem;color:var(--muted)">Plan: ${esc(u.plan)} - Credits: ${u.credits} - Role: ${esc(u.role || "none")}</div>
          <div style="font-size:.78rem;color:var(--muted);font-family:monospace">${esc(u.id)}</div>
        </div>
      </div>

      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px">
        <select id="editPlan" class="input" style="flex:1;min-width:140px">
          <option value="free" ${u.plan === "free" ? "selected" : ""}>Gatherly (Free)</option>
          <option value="pro" ${u.plan === "pro" ? "selected" : ""}>Gatherly Pro</option>
          <option value="ultra" ${u.plan === "ultra" ? "selected" : ""}>Gatherly Ultra</option>
        </select>
        <button class="btn btn-ghost btn-sm" data-action="set-plan" data-id="${esc(id)}">Set plan</button>
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
        <input id="creditAmt" type="number" min="0" class="input" placeholder="Credits" style="width:100px">
        <button class="btn btn-ghost btn-sm" data-action="adjust-credits" data-id="${esc(id)}" data-credit-action="credits-add">Add</button>
        <button class="btn btn-ghost btn-sm" data-action="adjust-credits" data-id="${esc(id)}" data-credit-action="credits-remove">Remove</button>
        <button class="btn btn-ghost btn-sm" data-action="adjust-credits" data-id="${esc(id)}" data-credit-action="credits-set">Set</button>
      </div>

      <div style="margin-bottom:10px">
        <div style="font-size:.78rem;color:var(--muted);margin-bottom:6px">Listing cap: <b>${u.effectiveCap === Infinity || u.effectiveCap === null ? "unlimited" : esc(String(u.effectiveCap))}</b> ${u.listingCapOverride !== null && u.listingCapOverride !== undefined ? `(override, plan default ${esc(String(u.planCapDefault))})` : `(plan default)`}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <input id="listingCapAmt" type="number" min="0" class="input" placeholder="Max listings" style="width:120px">
          <button class="btn btn-ghost btn-sm" data-action="set-listing-cap" data-id="${esc(id)}">Set cap</button>
          <button class="btn btn-ghost btn-sm" data-action="set-listing-cap" data-id="${esc(id)}" data-reset="true">Reset to plan</button>
        </div>
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
        <button class="btn btn-ghost btn-sm" data-action="toggle-suspend" data-id="${esc(id)}" data-suspend="${!u.suspended}">${u.suspended ? "Unsuspend" : "Suspend"}</button>
        <button class="btn btn-ghost btn-sm" data-action="wipe-listings" data-id="${esc(id)}">Wipe listings</button>
        ${u.supportBlacklisted
          ? `<button class="btn btn-ghost btn-sm" data-action="remove-blacklist" data-id="${esc(id)}">Remove blacklist</button>`
          : `<button class="btn btn-ghost btn-sm" data-action="add-blacklist" data-id="${esc(id)}">Blacklist support</button>`}
      </div>

      ${isExec ? `
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
        <select id="editRole" class="input" style="flex:1;min-width:140px">
          <option value="" ${!u.role ? "selected" : ""}>No role</option>
          <option value="admin" ${u.role === "admin" ? "selected" : ""}>Admin</option>
          <option value="executive" ${u.role === "executive" ? "selected" : ""}>Executive</option>
        </select>
        <button class="btn btn-ghost btn-sm" data-action="set-role" data-id="${esc(id)}">Set role</button>
      </div>
      <div style="margin-bottom:10px">
        <button class="btn btn-sm" style="background:var(--red,#ff7a7a);color:#fff" data-action="delete-account" data-id="${esc(id)}" data-username="${esc(u.username)}">Delete account</button>
      </div>` : ""}

      <div id="userMsg" style="margin-top:10px"></div>
    </div>`;
  wireImgFallback(host);
}

async function setPlan(id) {
  const plan = $("editPlan")?.value;
  const msg = $("userMsg");
  try {
    await api("/api/admin?action=set-plan", { method: "POST", body: { userId: id, plan } });
    if (msg) msg.innerHTML = `<div class="alert alert-ok">Plan updated to ${esc(plan)}.</div>`;
    loadUsers();
  } catch (e) { if (msg) msg.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; }
};

async function adjustCredits(id, action) {
  const amount = parseInt($("creditAmt")?.value, 10);
  const msg = $("userMsg");
  if (!Number.isFinite(amount)) { if (msg) msg.innerHTML = `<div class="alert alert-err">Enter a valid number.</div>`; return; }
  try {
    const d = await api(`/api/admin?action=${action}`, { method: "POST", body: { userId: id, amount } });
    if (msg) msg.innerHTML = `<div class="alert alert-ok">Credits updated. New total: ${d.credits}</div>`;
    loadUsers();
  } catch (e) { if (msg) msg.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; }
};

async function setListingCap(id, reset) {
  const msg = $("userMsg");
  const body = { userId: id };
  if (reset) { body.reset = true; }
  else {
    const v = $("listingCapAmt")?.value;
    if (v === "" || v === undefined) { if (msg) msg.innerHTML = `<div class="alert alert-err">Enter a cap, or use Reset to plan.</div>`; return; }
    body.cap = v;
  }
  try {
    const d = await api("/api/admin?action=set-listing-cap", { method: "POST", body });
    const capText = d.effectiveCap === null || d.effectiveCap === undefined ? "unlimited" : d.effectiveCap;
    if (msg) msg.innerHTML = `<div class="alert alert-ok">Listing cap ${reset ? "reset to plan default" : "updated"}. Effective cap: ${esc(String(capText))}.</div>`;
    loadUsers();
  } catch (e) { if (msg) msg.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; }
};

async function toggleSuspend(id, suspend) {
  const reason = suspend ? (prompt("Reason for suspension (optional):") || "") : "";
  const msg = $("userMsg");
  try {
    await api("/api/admin?action=suspend", { method: "POST", body: { userId: id, suspended: suspend, reason } });
    if (msg) msg.innerHTML = `<div class="alert alert-ok">${suspend ? "Suspended" : "Unsuspended"}.</div>`;
    loadUsers();
  } catch (e) { if (msg) msg.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; }
};

async function wipeListings(id) {
  if (!confirm("Wipe all event listings for this user? This cannot be undone.")) return;
  const msg = $("userMsg");
  try {
    const d = await api("/api/admin?action=wipe-listings", { method: "POST", body: { userId: id } });
    if (msg) msg.innerHTML = `<div class="alert alert-ok">${d.removed} listing(s) removed.</div>`;
  } catch (e) { if (msg) msg.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; }
};

async function addBlacklist(id) {
  const reason = prompt("Reason for support blacklist:");
  if (!reason) return;
  const msg = $("userMsg");
  try {
    await api("/api/admin?action=blacklist-add", { method: "POST", body: { userId: id, reason } });
    if (msg) msg.innerHTML = `<div class="alert alert-ok">User blacklisted from support.</div>`;
    loadUsers();
  } catch (e) { if (msg) msg.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; }
};

async function removeBlacklist(id) {
  const msg = $("userMsg");
  try {
    await api("/api/admin?action=blacklist-remove", { method: "POST", body: { userId: id } });
    if (msg) msg.innerHTML = `<div class="alert alert-ok">Blacklist removed.</div>`;
    loadUsers();
  } catch (e) { if (msg) msg.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; }
};

async function setRole(id) {
  const role = $("editRole")?.value || null;
  const msg = $("userMsg");
  try {
    const d = await api("/api/admin?action=set-role", { method: "POST", body: { userId: id, role } });
    if (msg) msg.innerHTML = d.pending
      ? `<div class="alert alert-ok">Request sent for approval. The role will not change until accepted via the Discord DM.</div>`
      : `<div class="alert alert-ok">Role updated.</div>`;
    loadUsers();
  } catch (e) { if (msg) msg.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; }
};

async function deleteAccount(id, username) {
  if (!confirm(`Permanently delete the account for "${username}"? This will also wipe all their event listings and cannot be undone.`)) return;
  if (!confirm("Are you absolutely sure? This action is irreversible.")) return;
  const msg = $("userMsg");
  try {
    const d = await api("/api/admin?action=delete-account", { method: "POST", body: { userId: id } });
    if (msg) msg.innerHTML = `<div class="alert alert-ok">Account deleted. ${d.eventsRemoved} event(s) removed.</div>`;
    const host = $("userDetail");
    if (host) host.innerHTML = "";
    loadUsers();
  } catch (e) { if (msg) msg.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; }
};

/* ========================== EVENTS ========================== */
async function loadEvents() {
  const host = $("eventList");
  if (!host) return;
  host.innerHTML = `<p style="color:var(--muted)">Loading...</p>`;
  try {
    const d = await api("/api/admin?action=events");
    const events = d.events || [];
    if (!events.length) { host.innerHTML = `<p style="color:var(--muted)">No events.</p>`; return; }
    host.innerHTML = events.map((ev) => `
      <div class="card" style="margin-bottom:8px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <div style="flex:1;min-width:0">
          <strong>${esc(ev.title)}</strong>
          <div style="font-size:.8rem;color:var(--muted)">${esc(ev.scenario || "")} - ${new Date(ev.startsAt).toLocaleString()} ${ev.boosted ? "- BOOSTED" : ""}</div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm" data-action="admin-boost" data-id="${esc(ev.id)}">${ev.boosted ? "Unboost" : "Boost"}</button>
          <button class="btn btn-ghost btn-sm" data-action="admin-end-event" data-id="${esc(ev.id)}">End</button>
          <button class="btn btn-sm" style="background:var(--red,#ff7a7a);color:#fff" data-action="admin-delete-event" data-id="${esc(ev.id)}">Delete</button>
        </div>
      </div>`).join("");
  } catch (e) { host.innerHTML = `<p style="color:var(--red,#ff7a7a)">${esc(e.message)}</p>`; }
}

async function adminBoost(id, btn) {
  try { const d = await api("/api/admin?action=boost", { method: "POST", body: { id } }); btn.textContent = d.boosted ? "Unboost" : "Boost"; }
  catch (e) { alert(e.message); }
};

async function adminEndEvent(id) {
  if (!confirm("Force-end this event?")) return;
  try { await api("/api/admin?action=end-event", { method: "POST", body: { id } }); loadEvents(); }
  catch (e) { alert(e.message); }
};

async function adminDeleteEvent(id) {
  if (!confirm("Permanently delete this event?")) return;
  try { await api("/api/admin?action=delete-event", { method: "POST", body: { id } }); loadEvents(); }
  catch (e) { alert(e.message); }
};

/* ========================== ANNOUNCEMENTS ========================== */
async function loadAnnouncements() {
  const host = $("announceList");
  if (!host) return;
  try {
    const d = await api("/api/admin?action=announce-list");
    const items = d.announcements || [];
    host.innerHTML = items.length
      ? items.map((a) => `
        <div class="card" style="margin-bottom:8px;display:flex;align-items:center;gap:12px">
          <div style="flex:1">${esc(a.text)} ${a.link ? `<a href="${esc(a.link)}" target="_blank" style="font-size:.8rem">Link</a>` : ""}
            ${a.cta ? `<span class="announce-cta" style="margin-left:8px;pointer-events:none">${esc(a.cta.text)}</span>` : ""}</div>
          <button class="btn btn-ghost btn-sm" data-action="remove-announce" data-id="${esc(a.id)}">Remove</button>
        </div>`).join("")
      : `<p style="color:var(--muted)">No active announcements.</p>`;
  } catch {}
}

async function addAnnounce() {
  const text = $("announceText")?.value?.trim();
  const link = $("announceLink")?.value?.trim();
  const ctaText = $("announceCtaText")?.value?.trim();
  const ctaLink = $("announceCtaLink")?.value?.trim();
  const durationMin = $("announceDuration")?.value;
  const msg = $("announceMsg");
  if (!text) { if (msg) msg.innerHTML = `<div class="alert alert-err">Enter announcement text.</div>`; return; }
  if (ctaText && !ctaLink) { if (msg) msg.innerHTML = `<div class="alert alert-err">Add a link for the CTA button.</div>`; return; }
  try {
    await api("/api/admin?action=announce-add", { method: "POST", body: { text, link, ctaText, ctaLink, durationMin } });
    ["announceText", "announceLink", "announceCtaText", "announceCtaLink"].forEach((k) => { if ($(k)) $(k).value = ""; });
    if (msg) msg.innerHTML = `<div class="alert alert-ok">Announcement added.</div>`;
    loadAnnouncements();
  } catch (e) { if (msg) msg.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; }
};

async function removeAnnounce(id) {
  try { await api("/api/admin?action=announce-remove", { method: "POST", body: { id } }); loadAnnouncements(); }
  catch (e) { alert(e.message); }
};

/* ========================== NOTIFICATIONS ========================== */
async function addNotification() {
  const title = $("notifyTitle")?.value?.trim();
  const body = $("notifyBody")?.value?.trim();
  const image = $("notifyImage")?.value?.trim();
  const link = $("notifyLink")?.value?.trim();
  const durationMin = $("notifyDuration")?.value;
  const msg = $("notifyMsg");
  if (!title) { if (msg) msg.innerHTML = `<div class="alert alert-err">Title is required.</div>`; return; }
  if (!confirm("Send this notification to all users?")) return;
  try {
    await api("/api/admin?action=notify-add", { method: "POST", body: { title, body, image, link, durationMin } });
    ["notifyTitle", "notifyBody", "notifyImage", "notifyLink"].forEach((k) => { if ($(k)) $(k).value = ""; });
    if (msg) msg.innerHTML = `<div class="alert alert-ok">Notification sent to all users.</div>`;
  } catch (e) { if (msg) msg.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; }
};

/* ========================== BROADCAST (Discord DM blast) ========================== */
function broadcastFormInput() {
  return {
    title: $("bcastTitle")?.value?.trim() || "",
    body: $("bcastBody")?.value?.trim() || "",
    image: $("bcastImage")?.value?.trim() || "",
    changeLogText: $("bcastChangeLogText")?.value?.trim() || "",
    changeLogUrl: $("bcastChangeLogUrl")?.value?.trim() || "",
  };
}

function previewBroadcast() {
  const f = broadcastFormInput();
  const host = $("bcastPreview");
  if (!host) return;
  if (!f.title) { host.innerHTML = `<div class="alert alert-err">Enter a title to preview.</div>`; return; }
  const hasChangeLog = f.changeLogUrl && /^https?:\/\//i.test(f.changeLogUrl);
  host.innerHTML = `
    <div style="border-left:3px solid #7fa8ff;border-radius:10px;background:rgba(127,168,255,.06);padding:14px 16px">
      <div style="font-weight:700;margin-bottom:6px">🟦 ${esc(f.title)}</div>
      ${f.body ? `<div style="color:var(--muted);white-space:pre-wrap;margin-bottom:10px">${esc(f.body)}</div>` : ""}
      ${f.image ? `<img src="${esc(f.image)}" class="js-img-fallback" style="max-width:100%;border-radius:8px;margin-bottom:10px">` : ""}
      <hr style="border-color:rgba(255,255,255,.08);margin:10px 0">
      <div style="font-size:12px;color:var(--muted);margin-bottom:10px">© Gatherly ${new Date().getFullYear()} | ER:LC Events &amp; Analytics</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${hasChangeLog ? `<span class="btn btn-secondary btn-sm" style="pointer-events:none">${esc(f.changeLogText || "View Full Change Log")} ↗</span>` : ""}
        <span class="btn btn-secondary btn-sm" style="pointer-events:none">Unsubscribe from Product Updates ↗</span>
      </div>
    </div>`;
  wireImgFallback(host);
}

async function testBroadcast() {
  const f = broadcastFormInput();
  const testDiscordId = $("bcastTestId")?.value?.trim();
  const msg = $("bcastTestMsg");
  if (!f.title) { if (msg) msg.innerHTML = `<div class="alert alert-err">Title is required.</div>`; return; }
  if (!testDiscordId) { if (msg) msg.innerHTML = `<div class="alert alert-err">Enter your Discord user ID first.</div>`; return; }
  if (msg) msg.innerHTML = `<div style="color:var(--muted)">Sending test DM&hellip;</div>`;
  try {
    await api("/api/broadcast?action=test", { method: "POST", body: { ...f, testDiscordId } });
    if (msg) msg.innerHTML = `<div class="alert alert-ok">Test DM sent. Check your Discord DMs.</div>`;
  } catch (e) { if (msg) msg.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; }
}

async function testPurchaseThanks() {
  const kind = $("thanksTestKind")?.value || "plan";
  const msg = $("thanksTestMsg");
  const body = kind === "credits" ? { kind, credits: parseInt($("thanksTestCredits")?.value, 10) || 6 } : { kind };
  if (msg) msg.innerHTML = `<div style="color:var(--muted)">Sending thank-you DM, receipt, and channel announcement&hellip;</div>`;
  try {
    await api("/api/billing?action=test-purchase-thanks", { method: "POST", body });
    if (msg) msg.innerHTML = `<div class="alert alert-ok">Sent. Check your Discord DMs (thank-you + receipt) and the supporters channel.</div>`;
  } catch (e) { if (msg) msg.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; }
}

async function testLiveCard() {
  const msg = $("liveCardTestMsg");
  if (msg) msg.innerHTML = `<div style="color:var(--muted)">Posting test card&hellip;</div>`;
  try {
    await api("/api/admin?action=test-live-card", { method: "POST" });
    if (msg) msg.innerHTML = `<div class="alert alert-ok">Posted. Check the live-notify channel.</div>`;
  } catch (e) { if (msg) msg.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; }
}

async function testStatusRefresh() {
  const msg = $("statusTestMsg");
  if (msg) msg.innerHTML = `<div style="color:var(--muted)">Refreshing&hellip;</div>`;
  try {
    await api("/api/admin?action=test-status-refresh", { method: "POST" });
    if (msg) msg.innerHTML = `<div class="alert alert-ok">Done. Check the status channel.</div>`;
  } catch (e) { if (msg) msg.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; }
}

async function loadThanksContent() {
  try {
    const d = await api("/api/admin?action=purchase-thanks-content");
    const c = d.content || {};
    if ($("thanksBenefitsPlan")) $("thanksBenefitsPlan").value = c.benefitsPhrasePlan || "";
    if ($("thanksBenefitsCredits")) $("thanksBenefitsCredits").value = c.benefitsPhraseCredits || "";
    if ($("thanksFooterBanner")) $("thanksFooterBanner").value = c.footerBannerUrl || "";
    if ($("thanksReceiptFooter")) $("thanksReceiptFooter").value = c.receiptFooterNote || "";
  } catch {}
}

async function saveThanksContent() {
  const msg = $("thanksContentMsg");
  const body = {
    benefitsPhrasePlan: $("thanksBenefitsPlan")?.value?.trim() || "",
    benefitsPhraseCredits: $("thanksBenefitsCredits")?.value?.trim() || "",
    footerBannerUrl: $("thanksFooterBanner")?.value?.trim() || "",
    receiptFooterNote: $("thanksReceiptFooter")?.value?.trim() || "",
  };
  try {
    await api("/api/admin?action=purchase-thanks-content-save", { method: "POST", body });
    if (msg) msg.innerHTML = `<div class="alert alert-ok">Saved.</div>`;
  } catch (e) { if (msg) msg.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; }
}

async function sendBroadcast() {
  const f = broadcastFormInput();
  const msg = $("bcastSendMsg");
  if (!f.title) { if (msg) msg.innerHTML = `<div class="alert alert-err">Title is required.</div>`; return; }

  // First confirmation: plain.
  if (!confirm("Send this Discord DM to every Gatherly member with a linked account? Test it on yourself first if you have not already.")) return;
  // Second confirmation: deliberately scarier, per the danger of mass-DMing the whole user base.
  const phrase = prompt('This cannot be undone once sent. Type "NOTIFY EVERYONE" exactly to confirm you want to notify every Gatherly member:');
  if (phrase !== "NOTIFY EVERYONE") {
    if (msg) msg.innerHTML = `<div class="alert alert-err">Cancelled, the confirmation phrase did not match.</div>`;
    return;
  }

  if (msg) msg.innerHTML = `<div style="color:var(--muted)">Sending to every connected user, this may take a moment&hellip;</div>`;
  try {
    const d = await api("/api/broadcast?action=send", { method: "POST", body: { ...f, confirm: true } });
    const r = d.run;
    if (msg) msg.innerHTML = `<div class="alert alert-ok">Sent to ${r.sent} of ${r.total} users (${r.skipped} unsubscribed, ${r.failed} failed).</div>`;
    loadBroadcastRuns();
  } catch (e) { if (msg) msg.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; }
}

async function loadBroadcastRuns() {
  const host = $("bcastRuns");
  if (!host) return;
  host.innerHTML = `<p style="color:var(--muted)">Loading&hellip;</p>`;
  try {
    const d = await api("/api/broadcast?action=runs");
    const audienceEl = $("bcastAudienceCount");
    if (audienceEl) audienceEl.textContent = `every connected user (${d.connectedCount - d.unsubscribedCount} of ${d.connectedCount}, ${d.unsubscribedCount} unsubscribed)`;
    if (!d.runs.length) { host.innerHTML = `<p style="color:var(--muted)">No broadcasts sent yet.</p>`; return; }
    host.innerHTML = d.runs.map((r) => `
      <div class="card" style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
          <strong>${esc(r.title)}</strong>
          <span style="color:var(--muted);font-size:13px">${new Date(r.at).toLocaleString()}</span>
        </div>
        <div style="color:var(--muted);font-size:13px;margin-top:4px">by ${esc(r.by)} · sent ${r.sent}/${r.total} · ${r.skipped} unsubscribed · ${r.failed} failed</div>
      </div>`).join("");
  } catch (e) { host.innerHTML = `<p style="color:var(--bad,#ff7a7a)">${esc(e.message)}</p>`; }
}

/* ========================== EXECUTIVE ========================== */
async function claimExec() {
  const code = $("execClaimCode")?.value?.trim();
  const msg = $("execClaimMsg");
  if (!code) { if (msg) msg.innerHTML = `<div class="alert alert-err">Enter the executive setup code.</div>`; return; }
  try {
    await api("/api/admin?action=claim-exec", { method: "POST", body: { code } });
    if (msg) msg.innerHTML = `<div class="alert alert-ok">Executive access unlocked. Reloading...</div>`;
    setTimeout(() => location.reload(), 900);
  } catch (e) { if (msg) msg.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; }
};

async function loadExec() {
  if (me.role !== "executive") return;
  try {
    const d = await api("/api/admin?action=codes");
    const codes = d.codes || [];
    const host = $("codeList");
    if (host) {
      host.innerHTML = codes.length
        ? codes.map((c) => {
          const dead = c.revoked || c.expired;
          const status = c.revoked ? "REVOKED" : c.expired ? "EXPIRED" : `valid · expires ${new Date(c.expiresAt).toLocaleTimeString()}`;
          return `
          <div class="card" style="margin-bottom:8px;display:flex;align-items:center;gap:12px;opacity:${dead ? ".5" : "1"}">
            <code style="flex:1;font-size:.82rem">${esc(c.fingerprint)}</code>
            <span style="font-size:.74rem;color:var(--muted)">${esc(c.role)} · ${esc(status)}${c.redemptions ? ` · ${c.redemptions} used` : ""}</span>
            ${!dead ? `<button class="btn btn-ghost btn-sm" data-action="revoke-code" data-key="${esc(c.key)}">Revoke</button>` : ""}
          </div>`;
        }).join("")
        : `<p style="color:var(--muted)">No codes generated yet. Codes are shown once at generation and stored hashed.</p>`;
    }
  } catch {}

  try {
    const d = await api("/api/admin?action=content");
    const content = d.content || {};
    if ($("heroHeadlineMain")) $("heroHeadlineMain").value = content.heroHeadlineMain || "";
    if ($("heroHeadlineAccent")) $("heroHeadlineAccent").value = content.heroHeadlineAccent || "";
    if ($("heroSub")) $("heroSub").value = content.heroSub || "";
  } catch {}
}

async function genCode() {
  const msg = $("execMsg");
  try {
    const d = await api("/api/admin?action=gen-code", { method: "POST", body: {} });
    if (msg) msg.innerHTML = `<div class="alert alert-ok">Admin code (copy now, shown once, expires ${new Date(d.expiresAt).toLocaleTimeString()}):<br><code style="font-size:1rem;user-select:all">${esc(d.code)}</code></div>`;
    loadExec();
  } catch (e) { if (msg) msg.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; }
};

async function revokeCode(key) {
  if (!confirm("Revoke this code?")) return;
  const msg = $("execMsg");
  try {
    await api("/api/admin?action=revoke-code", { method: "POST", body: { key } });
    if (msg) msg.innerHTML = `<div class="alert alert-ok">Code revoked.</div>`;
    loadExec();
  } catch (e) { if (msg) msg.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; }
};

async function saveContent() {
  const heroHeadlineMain = $("heroHeadlineMain")?.value?.trim();
  const heroHeadlineAccent = $("heroHeadlineAccent")?.value?.trim();
  const heroSub = $("heroSub")?.value?.trim();
  const msg = $("execMsg");
  try {
    await api("/api/admin?action=set-content", { method: "POST", body: { heroHeadlineMain, heroHeadlineAccent, heroSub } });
    if (msg) msg.innerHTML = `<div class="alert alert-ok">Homepage content updated.</div>`;
  } catch (e) { if (msg) msg.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; }
};

/* ========================== AUDIT LOG ========================== */
const ACTION_LABELS = {
  "ticket.create": "Opened a support ticket",
  "ticket.staff-reply": "Replied to a ticket",
  "ticket.claim": "Claimed a ticket",
  "ticket.unclaim": "Unclaimed a ticket",
  "ticket.close": "Closed a ticket",
  "ticket.reopen": "Reopened a ticket",
  "ticket.escalate": "Escalated a ticket",
  "ad.submit": "Submitted an advertisement",
  "ad.approve": "Approved an advertisement",
  "ad.deny": "Denied an advertisement",
  "ad.config": "Updated ad rotation settings",
  "ads.house-create": "Created a house ad",
  "ads.house-update": "Updated a house ad",
  "ads.house-delete": "Deleted a house ad",
  "news.create": "Created a news article",
  "news.update": "Updated a news article",
  "news.delete": "Deleted a news article",
  "announce.add": "Added an announcement",
  "announce.remove": "Removed an announcement",
  "notify.add": "Sent a notification",
  "notify.remove": "Removed a notification",
  "broadcast.send": "Sent a Discord DM broadcast",
  "broadcast.test": "Sent a Discord DM broadcast test",
  "broadcast.unsubscribe": "A user unsubscribed from DM broadcasts",
  "broadcast.resubscribe": "A user resubscribed to DM broadcasts",
  "user.set-plan": "Changed a user's plan",
  "user.set-role": "Changed a user's staff role",
  "user.set-listing-cap": "Changed a user's listing cap",
  "user.suspend": "Suspended a user",
  "user.unsuspend": "Unsuspended a user",
  "user.delete-account": "Deleted a user account",
  "user.wipe-listings": "Wiped a user's listings",
  "support.blacklist-add": "Blacklisted a user from support",
  "support.blacklist-remove": "Removed a support blacklist",
  "credits-add": "Added credits",
  "credits-remove": "Removed credits",
  "credits-set": "Set credits",
  "code.generate": "Generated an admin code",
  "code.revoke": "Revoked an admin code",
  "code.redeem-success": "Redeemed an access code",
  "code.redeem-failed": "Failed access code redemption",
  "exec.claim-success": "Unlocked executive access",
  "exec.claim-failed": "Failed executive access attempt",
  "site.content-update": "Updated homepage content",
  "event.boost": "Boosted an event",
  "event.unboost": "Unboosted an event",
  "event.end": "Ended an event early",
  "event.delete": "Deleted an event",
  "watchdog.resolve": "Resolved a security flag",
  "watchdog.escalate": "Escalated a security flag",
};
const describeAction = (action) => ACTION_LABELS[action] || action;

const DETAIL_PRIORITY = ["targetUsername", "ticketUser", "subject", "title", "advertiser", "reason", "plan", "role", "cap", "amount", "newTotal"];
const DETAIL_HIDE = new Set(["watchdog", "diagnosis", "fix", "aiResolution", "ip", "path", "targetId", "ticketId", "adId", "eventId", "id", "key"]);
function detailLine(detail = {}) {
  const parts = [];
  DETAIL_PRIORITY.forEach((k) => {
    if (detail[k] !== undefined && detail[k] !== null && detail[k] !== "") parts.push(`${k === "targetUsername" || k === "ticketUser" ? "user" : k}: ${detail[k]}`);
  });
  Object.entries(detail).forEach(([k, v]) => {
    if (DETAIL_HIDE.has(k) || DETAIL_PRIORITY.includes(k)) return;
    if (v === null || v === undefined || v === "" || typeof v === "object") return;
    parts.push(`${k}: ${v}`);
  });
  return parts.join(" - ");
}

async function loadAudit() {
  const host = $("auditList");
  if (!host) return;
  host.innerHTML = `<p style="color:var(--muted)">Loading...</p>`;
  try {
    const d = await api("/api/admin?action=audit");
    const entries = d.entries || [];
    if (!entries.length) { host.innerHTML = `<p style="color:var(--muted)">No audit entries.</p>`; return; }
    host.innerHTML = entries.map((e) => `
      <div class="card" style="margin-bottom:6px;font-size:.82rem;border-left:3px solid ${e.level === "warn" ? "var(--yellow,#ffcf5c)" : e.level === "error" ? "var(--red,#ff7a7a)" : "var(--border)"}">
        <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">
          <strong>${esc(describeAction(e.action))}</strong>
          <span style="color:var(--muted)">${new Date(e.at).toLocaleString()}</span>
        </div>
        <div style="color:var(--muted);margin-top:2px">${esc(e.actor?.username || "system")}${e.actor?.role ? ` (${esc(e.actor.role)})` : ""}</div>
        ${detailLine(e.detail) ? `<div style="margin-top:4px">${esc(detailLine(e.detail))}</div>` : ""}
        ${e.detail?.diagnosis ? `<div style="margin-top:4px;color:var(--yellow,#ffcf5c)">${esc(e.detail.diagnosis)}</div>` : ""}
        ${e.detail?.fix ? `<div style="color:var(--muted)">${esc(e.detail.fix)}</div>` : ""}
      </div>`).join("");
  } catch (e) { host.innerHTML = `<p style="color:var(--red,#ff7a7a)">${esc(e.message)}</p>`; }
}

/* ========================== USER SEARCH ========================== */
const searchInput = $("userSearch");
if (searchInput) {
  let debounce;
  searchInput.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => loadUsers(searchInput.value), 300);
  });
}

/* ========================== RICH TEXT EDITOR ========================== */
function initRichText() {
  const toolbar = $("rtToolbar");
  const editor = $("newsBody");
  if (!toolbar || !editor) return;
  const exec = (cmd, val = null) => { editor.focus(); document.execCommand(cmd, false, val); };

  toolbar.querySelectorAll(".rt-btn").forEach((btn) => {
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", () => {
      if (btn.dataset.cmd) exec(btn.dataset.cmd);
      else if (btn.dataset.align) exec("justify" + btn.dataset.align.charAt(0).toUpperCase() + btn.dataset.align.slice(1));
    });
  });

  const rtLink = $("rtLink");
  if (rtLink) rtLink.addEventListener("click", () => {
    const url = prompt("Link URL (https://...):");
    if (url) exec("createLink", url);
  });

  const rtImage = $("rtImage");
  if (rtImage) rtImage.addEventListener("click", () => {
    const url = prompt("Image URL (https://...):");
    if (url) exec("insertImage", url);
  });

  const rtBlock = $("rtBlock");
  if (rtBlock) rtBlock.addEventListener("change", () => { exec("formatBlock", rtBlock.value); rtBlock.selectedIndex = 0; });

  const rtSize = $("rtSize");
  if (rtSize) rtSize.addEventListener("change", () => { if (rtSize.value) exec("fontSize", rtSize.value); rtSize.selectedIndex = 0; });
}
initRichText();

/* ========================== ACTION ROUTER ==========================
   The site's Content-Security-Policy blocks inline event handler
   attributes (onclick, onerror, etc) for security, which is why none of
   the buttons on this page were doing anything. Every button below is
   wired through a single delegated listener via data-action attributes
   instead, which works fine under the CSP since it's all real JS in
   this module rather than inline HTML attributes. */
const ACTIONS = {
  "claim-exec": () => claimExec(),
  "add-announce": () => addAnnounce(),
  "remove-announce": (el) => removeAnnounce(el.dataset.id),
  "add-notification": () => addNotification(),
  "preview-broadcast": () => previewBroadcast(),
  "test-broadcast": () => testBroadcast(),
  "test-purchase-thanks": () => testPurchaseThanks(),
  "test-live-card": () => testLiveCard(),
  "test-status-refresh": () => testStatusRefresh(),
  "save-thanks-content": () => saveThanksContent(),
  "send-broadcast": () => sendBroadcast(),
  "save-ad-config": () => saveAdConfig(),
  "approve-ad": (el) => approveAd(el.dataset.id),
  "deny-ad": (el) => denyAd(el.dataset.id),
  "save-house-ad": () => saveHouseAd(),
  "clear-house-ad": () => clearHouseAd(),
  "edit-house-ad": (el) => editHouseAd(el.dataset.id),
  "toggle-house-ad": (el) => toggleHouseAd(el.dataset.id, el.dataset.off === "true"),
  "delete-house-ad": (el) => deleteHouseAd(el.dataset.id),
  "new-article": () => newArticle(),
  "refresh-news": () => loadNews(),
  "edit-news": (el) => editNews(el.dataset.id),
  "save-news": () => saveNews(),
  "delete-news": () => deleteNews(),
  "resolve-flag": (el) => resolveFlag(el.dataset.key, el),
  "escalate-flag": (el) => escalateFlag(el.dataset.key, el),
  "goto-support": () => switchTab("support"),
  "send-staff-reply": (el) => sendStaffReply(el.dataset.id),
  "claim-ticket": (el) => claimTicket(el.dataset.id),
  "unclaim-ticket": (el) => unclaimTicket(el.dataset.id),
  "close-ticket": (el) => closeTicket(el.dataset.id),
  "set-plan": (el) => setPlan(el.dataset.id),
  "adjust-credits": (el) => adjustCredits(el.dataset.id, el.dataset.creditAction),
  "set-listing-cap": (el) => setListingCap(el.dataset.id, el.dataset.reset === "true"),
  "toggle-suspend": (el) => toggleSuspend(el.dataset.id, el.dataset.suspend === "true"),
  "wipe-listings": (el) => wipeListings(el.dataset.id),
  "add-blacklist": (el) => addBlacklist(el.dataset.id),
  "remove-blacklist": (el) => removeBlacklist(el.dataset.id),
  "set-role": (el) => setRole(el.dataset.id),
  "delete-account": (el) => deleteAccount(el.dataset.id, el.dataset.username),
  "admin-boost": (el) => adminBoost(el.dataset.id, el),
  "admin-end-event": (el) => adminEndEvent(el.dataset.id),
  "admin-delete-event": (el) => adminDeleteEvent(el.dataset.id),
  "gen-code": () => genCode(),
  "revoke-code": (el) => revokeCode(el.dataset.key),
  "save-content": () => saveContent(),
};

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const handler = ACTIONS[el.dataset.action];
  if (handler) handler(el, e);
});

$("thanksTestKind")?.addEventListener("change", () => {
  const wrap = $("thanksTestCreditsWrap");
  if (wrap) wrap.hidden = $("thanksTestKind").value !== "credits";
});

init();
