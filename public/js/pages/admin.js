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
    $("newsBlocks").value = (a.blocks || []).map((b) => b.type === "image" ? `img:${b.value}` : b.type === "heading" ? `h:${b.value}` : b.value).join("\n");
    $("newsPublished").checked = Boolean(a.published);
  } catch (e) { alert(e.message); }
};

function parseBlocks(text) {
  const lines = String(text || "").split(/\n/);
  const out = [];
  let buf = [];
  const flush = () => { if (buf.length) { out.push({ type: "text", value: buf.join("\n").trim() }); buf = []; } };
  for (const l of lines) {
    if (/^img:\s*/i.test(l)) { flush(); out.push({ type: "image", value: l.replace(/^img:\s*/i, "").trim() }); continue; }
    if (/^h:\s*/i.test(l)) { flush(); out.push({ type: "heading", value: l.replace(/^h:\s*/i, "").trim() }); continue; }
    if (l.trim() === "") { flush(); continue; }
    buf.push(l);
  }
  flush();
  return out.filter((b) => b.value);
}

window.saveNews = async () => {
  const msg = $("newsMsg");
  const body = {
    id: $("newsId").value || undefined,
    title: $("newsTitleInput").value.trim(),
    authorName: $("newsAuthor").value.trim(),
    authorAvatar: $("newsAvatar").value.trim(),
    banner: $("newsBanner").value.trim(),
    excerpt: $("newsExcerpt").value.trim(),
    blocks: parseBlocks($("newsBlocks").value),
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

window.deleteNews = async () => {
  const id = $("newsId").value;
  if (!id) return;
  if (!confirm("Delete this article? This cannot be undone.")) return;
  try {
    await api("/api/news?action=delete", { method: "POST", body: { id } });
    window.newArticle(); loadNews();
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
            <button class="btn btn-ghost btn-sm" onclick="resolveFlag('${esc(f.key)}',this)">Resolve</button>
            <button class="btn btn-ghost btn-sm" onclick="escalateFlag('${esc(f.key)}',this)">Escalate</button>
          </div>
        </div>
      </div>`).join("") : `<p style="color:var(--muted)">No security flags this week. All clear.</p>`;

    const tk = $("checklistTickets");
    if (tk) tk.innerHTML = (d.tickets || []).length ? d.tickets.map((t) => `
      <div class="card" style="margin-bottom:8px;display:flex;align-items:center;gap:12px;cursor:pointer" onclick="document.querySelector('.cr-tab[data-tab=support]').click()">
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

window.resolveFlag = async (key, btn) => {
  try { await api("/api/admin?action=resolve-flag", { method: "POST", body: { key } }); if (btn) btn.closest(".card").style.opacity = ".4"; loadChecklist(); }
  catch (e) { alert(e.message); }
};
window.escalateFlag = async (key, btn) => {
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
  host.innerHTML = `
    <div class="card" style="margin-top:16px">
      <h3 style="margin-bottom:4px">${esc(t.subject)}</h3>
      <div style="font-size:.82rem;color:var(--muted);margin-bottom:14px">${esc(t.username)} - ${esc(t.topic)} - Ticket <code>${esc(t.id)}</code></div>
      <div style="max-height:340px;overflow-y:auto;margin-bottom:14px">${msgs || "<p style='color:var(--muted)'>No messages.</p>"}</div>
      <textarea id="staffReply" class="input" rows="3" placeholder="Type your reply..." style="width:100%;margin-bottom:10px"></textarea>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary btn-sm" onclick="sendStaffReply('${esc(id)}')">Send reply</button>
        <button class="btn btn-ghost btn-sm" onclick="closeTicket('${esc(id)}')">Close ticket</button>
      </div>
      <div id="ticketMsg" style="margin-top:10px"></div>
    </div>`;
}

window.sendStaffReply = async (id) => {
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

window.closeTicket = async (id) => {
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
        ${u.avatar && u.discordId ? `<img src="https://cdn.discordapp.com/avatars/${esc(u.discordId)}/${esc(u.avatar)}.png?size=64" style="width:36px;height:36px;border-radius:50%;flex-shrink:0" onerror="this.style.display='none'">` : `<span style="width:36px;height:36px;border-radius:50%;background:var(--signal-deep);display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;flex-shrink:0">${esc((u.username || "?")[0].toUpperCase())}</span>`}
        <div style="flex:1;min-width:0">
          <strong>${esc(u.username)}</strong>
          ${u.globalName && u.globalName !== u.username ? `<span style="color:var(--muted);font-size:.82rem"> (${esc(u.globalName)})</span>` : ""}
          <div style="font-size:.78rem;color:var(--muted)">${esc(u.plan)} ${u.role ? "- " + esc(u.role) : ""} ${u.suspended ? "- SUSPENDED" : ""}</div>
        </div>
        <span style="font-size:.8rem;color:var(--muted)">${u.credits} credits</span>
      </div>`).join("");
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
    ? `<img src="https://cdn.discordapp.com/avatars/${esc(u.discordId)}/${esc(u.avatar)}.png?size=128" style="width:52px;height:52px;border-radius:50%" onerror="this.style.display='none'">`
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
        <button class="btn btn-ghost btn-sm" onclick="setPlan('${esc(id)}')">Set plan</button>
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
        <input id="creditAmt" type="number" min="0" class="input" placeholder="Credits" style="width:100px">
        <button class="btn btn-ghost btn-sm" onclick="adjustCredits('${esc(id)}','credits-add')">Add</button>
        <button class="btn btn-ghost btn-sm" onclick="adjustCredits('${esc(id)}','credits-remove')">Remove</button>
        <button class="btn btn-ghost btn-sm" onclick="adjustCredits('${esc(id)}','credits-set')">Set</button>
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
        <button class="btn btn-ghost btn-sm" onclick="toggleSuspend('${esc(id)}',${!u.suspended})">${u.suspended ? "Unsuspend" : "Suspend"}</button>
        <button class="btn btn-ghost btn-sm" onclick="wipeListings('${esc(id)}')">Wipe listings</button>
        ${u.supportBlacklisted
          ? `<button class="btn btn-ghost btn-sm" onclick="removeBlacklist('${esc(id)}')">Remove blacklist</button>`
          : `<button class="btn btn-ghost btn-sm" onclick="addBlacklist('${esc(id)}')">Blacklist support</button>`}
      </div>

      ${isExec ? `
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
        <select id="editRole" class="input" style="flex:1;min-width:140px">
          <option value="" ${!u.role ? "selected" : ""}>No role</option>
          <option value="admin" ${u.role === "admin" ? "selected" : ""}>Admin</option>
          <option value="executive" ${u.role === "executive" ? "selected" : ""}>Executive</option>
        </select>
        <button class="btn btn-ghost btn-sm" onclick="setRole('${esc(id)}')">Set role</button>
      </div>
      <div style="margin-bottom:10px">
        <button class="btn btn-sm" style="background:var(--red,#ff7a7a);color:#fff" onclick="deleteAccount('${esc(id)}','${esc(u.username)}')">Delete account</button>
      </div>` : ""}

      <div id="userMsg" style="margin-top:10px"></div>
    </div>`;
}

window.setPlan = async (id) => {
  const plan = $("editPlan")?.value;
  const msg = $("userMsg");
  try {
    await api("/api/admin?action=set-plan", { method: "POST", body: { userId: id, plan } });
    if (msg) msg.innerHTML = `<div class="alert alert-ok">Plan updated to ${esc(plan)}.</div>`;
    loadUsers();
  } catch (e) { if (msg) msg.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; }
};

window.adjustCredits = async (id, action) => {
  const amount = parseInt($("creditAmt")?.value, 10);
  const msg = $("userMsg");
  if (!Number.isFinite(amount)) { if (msg) msg.innerHTML = `<div class="alert alert-err">Enter a valid number.</div>`; return; }
  try {
    const d = await api(`/api/admin?action=${action}`, { method: "POST", body: { userId: id, amount } });
    if (msg) msg.innerHTML = `<div class="alert alert-ok">Credits updated. New total: ${d.credits}</div>`;
    loadUsers();
  } catch (e) { if (msg) msg.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; }
};

window.toggleSuspend = async (id, suspend) => {
  const reason = suspend ? (prompt("Reason for suspension (optional):") || "") : "";
  const msg = $("userMsg");
  try {
    await api("/api/admin?action=suspend", { method: "POST", body: { userId: id, suspended: suspend, reason } });
    if (msg) msg.innerHTML = `<div class="alert alert-ok">${suspend ? "Suspended" : "Unsuspended"}.</div>`;
    loadUsers();
  } catch (e) { if (msg) msg.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; }
};

window.wipeListings = async (id) => {
  if (!confirm("Wipe all event listings for this user? This cannot be undone.")) return;
  const msg = $("userMsg");
  try {
    const d = await api("/api/admin?action=wipe-listings", { method: "POST", body: { userId: id } });
    if (msg) msg.innerHTML = `<div class="alert alert-ok">${d.removed} listing(s) removed.</div>`;
  } catch (e) { if (msg) msg.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; }
};

window.addBlacklist = async (id) => {
  const reason = prompt("Reason for support blacklist:");
  if (!reason) return;
  const msg = $("userMsg");
  try {
    await api("/api/admin?action=blacklist-add", { method: "POST", body: { userId: id, reason } });
    if (msg) msg.innerHTML = `<div class="alert alert-ok">User blacklisted from support.</div>`;
    loadUsers();
  } catch (e) { if (msg) msg.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; }
};

window.removeBlacklist = async (id) => {
  const msg = $("userMsg");
  try {
    await api("/api/admin?action=blacklist-remove", { method: "POST", body: { userId: id } });
    if (msg) msg.innerHTML = `<div class="alert alert-ok">Blacklist removed.</div>`;
    loadUsers();
  } catch (e) { if (msg) msg.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; }
};

window.setRole = async (id) => {
  const role = $("editRole")?.value || null;
  const msg = $("userMsg");
  try {
    await api("/api/admin?action=set-role", { method: "POST", body: { userId: id, role } });
    if (msg) msg.innerHTML = `<div class="alert alert-ok">Role updated.</div>`;
    loadUsers();
  } catch (e) { if (msg) msg.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; }
};

window.deleteAccount = async (id, username) => {
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
          <button class="btn btn-ghost btn-sm" onclick="adminBoost('${esc(ev.id)}',this)">${ev.boosted ? "Unboost" : "Boost"}</button>
          <button class="btn btn-ghost btn-sm" onclick="adminEndEvent('${esc(ev.id)}')">End</button>
          <button class="btn btn-sm" style="background:var(--red,#ff7a7a);color:#fff" onclick="adminDeleteEvent('${esc(ev.id)}')">Delete</button>
        </div>
      </div>`).join("");
  } catch (e) { host.innerHTML = `<p style="color:var(--red,#ff7a7a)">${esc(e.message)}</p>`; }
}

window.adminBoost = async (id, btn) => {
  try { const d = await api("/api/admin?action=boost", { method: "POST", body: { id } }); btn.textContent = d.boosted ? "Unboost" : "Boost"; }
  catch (e) { alert(e.message); }
};

window.adminEndEvent = async (id) => {
  if (!confirm("Force-end this event?")) return;
  try { await api("/api/admin?action=end-event", { method: "POST", body: { id } }); loadEvents(); }
  catch (e) { alert(e.message); }
};

window.adminDeleteEvent = async (id) => {
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
          <button class="btn btn-ghost btn-sm" onclick="removeAnnounce('${esc(a.id)}')">Remove</button>
        </div>`).join("")
      : `<p style="color:var(--muted)">No active announcements.</p>`;
  } catch {}
}

window.addAnnounce = async () => {
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

window.removeAnnounce = async (id) => {
  try { await api("/api/admin?action=announce-remove", { method: "POST", body: { id } }); loadAnnouncements(); }
  catch (e) { alert(e.message); }
};

/* ========================== NOTIFICATIONS ========================== */
window.addNotification = async () => {
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

/* ========================== EXECUTIVE ========================== */
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
            ${!dead ? `<button class="btn btn-ghost btn-sm" onclick="revokeCode('${esc(c.key)}')">Revoke</button>` : ""}
          </div>`;
        }).join("")
        : `<p style="color:var(--muted)">No codes generated yet. Codes are shown once at generation and stored hashed.</p>`;
    }
  } catch {}

  try {
    const d = await api("/api/admin?action=content");
    const content = d.content || {};
    if ($("heroHeadline")) $("heroHeadline").value = content.heroHeadline || "";
    if ($("heroSub")) $("heroSub").value = content.heroSub || "";
  } catch {}
}

window.genCode = async () => {
  const msg = $("execMsg");
  try {
    const d = await api("/api/admin?action=gen-code", { method: "POST", body: {} });
    if (msg) msg.innerHTML = `<div class="alert alert-ok">Admin code (copy now — shown once, expires ${new Date(d.expiresAt).toLocaleTimeString()}):<br><code style="font-size:1rem;user-select:all">${esc(d.code)}</code></div>`;
    loadExec();
  } catch (e) { if (msg) msg.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; }
};

window.revokeCode = async (key) => {
  if (!confirm("Revoke this code?")) return;
  const msg = $("execMsg");
  try {
    await api("/api/admin?action=revoke-code", { method: "POST", body: { key } });
    if (msg) msg.innerHTML = `<div class="alert alert-ok">Code revoked.</div>`;
    loadExec();
  } catch (e) { if (msg) msg.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; }
};

window.saveContent = async () => {
  const heroHeadline = $("heroHeadline")?.value?.trim();
  const heroSub = $("heroSub")?.value?.trim();
  const msg = $("execMsg");
  try {
    await api("/api/admin?action=set-content", { method: "POST", body: { heroHeadline, heroSub } });
    if (msg) msg.innerHTML = `<div class="alert alert-ok">Homepage content updated.</div>`;
  } catch (e) { if (msg) msg.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; }
};

/* ========================== AUDIT LOG ========================== */
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
          <strong>${esc(e.action)}</strong>
          <span style="color:var(--muted)">${new Date(e.at).toLocaleString()}</span>
        </div>
        <div style="color:var(--muted);margin-top:2px">${esc(e.actor?.username || "system")} ${e.detail?.targetId ? "- target: " + esc(e.detail.targetId) : ""}</div>
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

init();
