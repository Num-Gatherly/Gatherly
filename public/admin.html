// /js/pages/admin.js — the staff control room.
// Tabs: Support (live chat) · Events · Users · Site · Executive · Audit.
// Exec-only tabs/sections are hidden for plain admins.
import { boot, api, esc, fmtLocal } from "/js/app.js";

boot("/admin");

const $ = (id) => document.getElementById(id);
const gate = $("gate"), panel = $("panel"), msg = $("msg");
let me = null;            // { id, username, role }
let chatTimer = null;     // live-chat polling
let openChatId = null;

const flash = (el, text, ok = false) => {
  el.innerHTML = `<div class="notice ${ok ? "ok" : "err"}">${esc(text)}</div>`;
  if (ok) setTimeout(() => { if (el.firstChild) el.innerHTML = ""; }, 3500);
};

// ---------- boot: figure out if this person is staff ----------
init();
async function init() {
  try {
    me = await api("/api/admin?action=whoami");
    showPanel();
  } catch {
    showGate();
  }
}

// ---------- the access gate (claim exec / redeem code / request) ----------
function showGate() {
  panel.hidden = true;
  gate.hidden = false;
  // Rebuild the gate so it offers all three paths cleanly.
  gate.innerHTML = `
    <h3>Staff access</h3>
    <p style="margin:6px 0 16px">Enter an access code from an executive, claim the executive role with the setup code, or request admin access for review.</p>
    <label class="field">Access code
      <input id="accessCode" autocomplete="off" placeholder="GATH-XXXX-XXXX or executive setup code">
    </label>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn btn-primary btn-sm" id="redeemBtn">Redeem code</button>
      <button class="btn btn-ghost btn-sm" id="claimExecBtn">Use as executive setup code</button>
      <button class="btn btn-ghost btn-sm" id="reqBtn">Request admin access</button>
    </div>
    <div id="gateMsg" style="margin-top:12px"></div>`;

  const gateMsg = $("gateMsg");
  const codeVal = () => $("accessCode").value.trim();

  $("redeemBtn").onclick = async () => {
    if (!codeVal()) return flash(gateMsg, "Enter your access code first.");
    try {
      const d = await api("/api/admin?action=redeem-code", { method: "POST", body: { code: codeVal() } });
      flash(gateMsg, `Access granted: ${d.role}. Loading panel…`, true);
      setTimeout(init, 700);
    } catch (e) { flash(gateMsg, e.message); }
  };
  $("claimExecBtn").onclick = async () => {
    if (!codeVal()) return flash(gateMsg, "Enter the executive setup code first.");
    try {
      const d = await api("/api/admin?action=claim-exec", { method: "POST", body: { code: codeVal() } });
      flash(gateMsg, `You are now ${d.role}. Loading panel…`, true);
      setTimeout(init, 700);
    } catch (e) { flash(gateMsg, e.message); }
  };
  $("reqBtn").onclick = async () => {
    try {
      await api("/api/admin?action=request-admin", { method: "POST", body: { note: "" } });
      flash(gateMsg, "Request sent. An executive will review it.", true);
    } catch (e) { flash(gateMsg, e.message); }
  };
}

// ---------- the panel ----------
function showPanel() {
  gate.hidden = true;
  panel.hidden = false;
  const exec = me.role === "executive";
  $("role").textContent = `Signed in as ${me.username} · ${me.role}. Every action is audit-logged.`;

  // Build a tab bar + sections, overriding the static markup so we fully control it.
  panel.innerHTML = `
    <div class="tabs" id="tabs">
      <button data-tab="support" class="tab active">Support <span class="tab-badge" id="supBadge" hidden>0</span></button>
      <button data-tab="events" class="tab">Events</button>
      <button data-tab="users" class="tab">Users</button>
      <button data-tab="site" class="tab">Site</button>
      ${exec ? `<button data-tab="exec" class="tab">Executive</button>` : ""}
      <button data-tab="audit" class="tab">Audit</button>
    </div>
    <div id="msg"></div>

    <div class="tabpane" data-pane="support">
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
          <h3>Support chats</h3>
          <div class="seg" id="supFilter">
            <button data-status="open" class="seg-btn active">Unresolved</button>
            <button data-status="closed" class="seg-btn">Resolved</button>
          </div>
        </div>
        <div class="support-grid" style="margin-top:14px">
          <div id="chatList"><p class="note">Loading…</p></div>
          <div id="chatView"><p class="note">Select a chat to open it.</p></div>
        </div>
      </div>
    </div>

    <div class="tabpane" data-pane="events" hidden>
      <div class="card"><h3>All events</h3><div id="evTable" style="margin-top:14px;overflow-x:auto"><p>Loading…</p></div></div>
      <div class="card" id="evEdit" hidden style="margin-top:18px">
        <h3>Edit event</h3>
        <div class="grid grid-2" style="margin-top:12px">
          <label class="field">Title<input id="eTitle" maxlength="80"></label>
          <label class="field">Scenario<input id="eScenario" maxlength="40"></label>
          <label class="field">Start time<input id="eStartsAt" type="datetime-local"></label>
          <label class="field">Length (minutes, 15-90)<input id="eDuration" type="number" min="15" max="90"></label>
        </div>
        <label class="field">Description<textarea id="eDesc" rows="2" maxlength="400"></textarea></label>
        <label class="field" style="display:flex;align-items:center;gap:10px;font-weight:500">
          <input type="checkbox" id="eBoosted" style="width:auto;margin:0"> Boosted placement
        </label>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" id="saveEvent">Save changes</button>
          <button class="btn btn-ghost btn-sm" id="cancelEdit">Cancel</button>
        </div>
      </div>
    </div>

    <div class="tabpane" data-pane="users" hidden>
      <div class="card"><h3>Users</h3><div id="userTable" style="margin-top:14px;overflow-x:auto"><p>Loading…</p></div></div>
    </div>

    <div class="tabpane" data-pane="site" hidden>
      <div class="card">
        <h3>Homepage content</h3>
        <p style="font-size:.88rem;margin:6px 0 14px">Edits the hero live, no deploy needed.</p>
        <div class="grid grid-2">
          <label class="field">Hero headline<input id="heroHeadline" maxlength="200"></label>
          <label class="field">Hero subline<input id="heroSub" maxlength="200"></label>
        </div>
        <label class="field">Site-wide announcement <small>Shown as a banner. Leave blank to hide.</small><input id="announcement" maxlength="200"></label>
        <button class="btn btn-primary btn-sm" id="saveContent">Save content</button>
      </div>
    </div>

    ${exec ? `
    <div class="tabpane" data-pane="exec" hidden>
      <div class="card">
        <h3>Access codes <span class="badge badge-boost">Executive</span></h3>
        <p style="font-size:.88rem;margin:6px 0 14px">Generate a code for someone to redeem under Settings → Staff access. Reusable until you revoke it.</p>
        <div class="grid grid-2">
          <label class="field">Label <small>e.g. "Weekend mod team"</small><input id="codeLabel" maxlength="60"></label>
          <label class="field">Grants role<select id="codeRole"><option value="admin">admin</option><option value="executive">executive</option></select></label>
        </div>
        <button class="btn btn-primary btn-sm" id="genCode">Generate code</button>
        <div id="codeList" style="margin-top:18px"><p class="note">Loading…</p></div>
      </div>

      <div class="card" style="margin-top:18px">
        <h3>Set a role directly</h3>
        <p style="font-size:.88rem;margin:6px 0 14px">Promote or demote by Discord username (they must have signed in at least once).</p>
        <div class="grid grid-2">
          <label class="field">Username<input id="roleUser" autocomplete="off"></label>
          <label class="field">Role<select id="roleSel"><option value="admin">admin</option><option value="executive">executive</option><option value="none">none (remove)</option></select></label>
        </div>
        <button class="btn btn-primary btn-sm" id="setRole">Apply role</button>
      </div>

      <div class="card" style="margin-top:18px">
        <h3>Admin access requests</h3>
        <div id="adminReqs" style="margin-top:10px"><p class="note">Loading…</p></div>
      </div>
    </div>` : ""}

    <div class="tabpane" data-pane="audit" hidden>
      <div class="card">
        <h3>Audit log</h3>
        <p style="font-size:.88rem;margin:6px 0 14px">Last 100 staff and host actions, newest first.</p>
        <button class="btn btn-ghost btn-sm" id="loadAudit">Refresh audit log</button>
        <div id="auditOut" style="margin-top:14px;overflow-x:auto"></div>
      </div>
    </div>`;

  wireTabs();
  wireSupport();
  wireEvents();
  wireUsers();
  wireSite();
  if (exec) wireExec();
  wireAudit();

  // initial loads
  loadSupportList("open");
  pollCounts();
  setInterval(pollCounts, 8000);
}

// ---------- tabs ----------
function wireTabs() {
  const tabs = $("tabs");
  tabs.querySelectorAll(".tab").forEach((btn) => {
    btn.onclick = () => {
      tabs.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b === btn));
      const which = btn.dataset.tab;
      panel.querySelectorAll(".tabpane").forEach((p) => { p.hidden = p.dataset.pane !== which; });
      if (which === "events") loadEvents();
      if (which === "users") loadUsers();
      if (which === "site") loadContent();
      if (which === "exec") { loadCodes(); loadRequests(); }
      if (which === "audit") loadAudit();
    };
  });
}

async function pollCounts() {
  try {
    const d = await api("/api/tickets?action=counts");
    const badge = $("supBadge");
    if (badge) { badge.hidden = !d.open; badge.textContent = d.open; }
  } catch { /* ignore */ }
}

// ========================= SUPPORT (live chat) =========================
function wireSupport() {
  const seg = $("supFilter");
  seg.querySelectorAll(".seg-btn").forEach((b) => {
    b.onclick = () => {
      seg.querySelectorAll(".seg-btn").forEach((x) => x.classList.toggle("active", x === b));
      loadSupportList(b.dataset.status);
    };
  });
}

async function loadSupportList(status) {
  const list = $("chatList");
  try {
    const d = await api(`/api/tickets?action=list&status=${status}`);
    if (!d.tickets.length) { list.innerHTML = `<p class="note">No ${status === "open" ? "unresolved" : "resolved"} chats.</p>`; return; }
    list.innerHTML = d.tickets.map((t) => `
      <button class="chat-item ${t.id === openChatId ? "active" : ""}" data-id="${t.id}">
        <div class="chat-item-top"><b>${esc(t.subject)}</b>${t.assignedToName ? `<span class="badge">${esc(t.assignedToName)}</span>` : `<span class="badge badge-live">new</span>`}</div>
        <div class="chat-item-sub">@${esc(t.username)} · ${esc(t.topic)} · ${fmtLocal(t.updatedAt)}</div>
      </button>`).join("");
    list.querySelectorAll(".chat-item").forEach((el) => {
      el.onclick = () => openChat(el.dataset.id);
    });
  } catch (e) { list.innerHTML = `<p class="note">${esc(e.message)}</p>`; }
}

async function openChat(id) {
  openChatId = id;
  if (chatTimer) clearInterval(chatTimer);
  await renderChat();
  chatTimer = setInterval(renderChat, 3000); // live polling
  document.querySelectorAll(".chat-item").forEach((el) =>
    el.classList.toggle("active", el.dataset.id === id));
}

async function renderChat() {
  const view = $("chatView");
  if (!openChatId) return;
  let t;
  try { ({ ticket: t } = await api(`/api/tickets?action=get&id=${openChatId}`)); }
  catch (e) { view.innerHTML = `<p class="note">${esc(e.message)}</p>`; return; }

  const closed = t.status === "closed";
  view.innerHTML = `
    <div class="chat-head">
      <div>
        <b>${esc(t.subject)}</b>
        <div class="chat-item-sub">@${esc(t.username)} · ${esc(t.topic)} · ${closed ? "resolved" : "open"}${t.assignedToName ? ` · handling: ${esc(t.assignedToName)}` : ""}</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${!t.assignedTo && !closed ? `<button class="btn btn-ghost btn-sm" id="claimChat">Claim</button>` : ""}
        ${closed ? `<button class="btn btn-ghost btn-sm" id="reopenChat">Reopen</button>`
                 : `<button class="btn btn-ghost btn-sm" id="closeChat">Mark resolved</button>`}
      </div>
    </div>
    <div class="chat-log" id="chatLog">
      ${t.messages.map((m) => `
        <div class="chat-msg ${m.from === "staff" ? "from-staff" : "from-user"}">
          <div class="chat-msg-meta">${esc(m.by)} · ${new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
          <div class="chat-bubble">${esc(m.text)}</div>
        </div>`).join("")}
    </div>
    ${closed ? `<p class="note" style="margin-top:10px">This chat is resolved. Reopen it to reply.</p>` : `
    <div class="chat-compose">
      <textarea id="chatInput" rows="2" maxlength="2000" placeholder="Reply to @${esc(t.username)}…"></textarea>
      <button class="btn btn-primary btn-sm" id="sendChat">Send</button>
    </div>`}`;

  const log = $("chatLog"); if (log) log.scrollTop = log.scrollHeight;

  $("claimChat") && ($("claimChat").onclick = async () => {
    await api(`/api/tickets?action=assign&id=${openChatId}`, { method: "POST" });
    renderChat();
  });
  $("closeChat") && ($("closeChat").onclick = async () => {
    await api(`/api/tickets?action=close&id=${openChatId}`, { method: "POST" });
    renderChat(); loadSupportList("open"); pollCounts();
  });
  $("reopenChat") && ($("reopenChat").onclick = async () => {
    await api(`/api/tickets?action=reopen&id=${openChatId}`, { method: "POST" });
    renderChat(); pollCounts();
  });
  const send = $("sendChat"), input = $("chatInput");
  if (send && input) {
    const fire = async () => {
      const text = input.value.trim(); if (!text) return;
      input.value = "";
      try { await api(`/api/tickets?action=reply&id=${openChatId}`, { method: "POST", body: { text } }); }
      catch (e) { flash($("msg"), e.message); }
      renderChat();
    };
    send.onclick = fire;
    input.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); fire(); } };
  }
}

// ========================= EVENTS =========================
function wireEvents() {
  $("cancelEdit").onclick = () => { $("evEdit").hidden = true; };
  $("saveEvent").onclick = saveEvent;
}
let editingId = null;
async function loadEvents() {
  const wrap = $("evTable");
  try {
    const d = await api("/api/admin?action=events");
    if (!d.events.length) { wrap.innerHTML = `<p class="note">No events.</p>`; return; }
    wrap.innerHTML = `<table class="tbl"><thead><tr>
      <th>Title</th><th>Host</th><th>Scenario</th><th>Starts</th><th>Status</th><th>Views</th><th></th>
    </tr></thead><tbody>${d.events.map((e) => `
      <tr>
        <td>${esc(e.title)}${e.boosted ? ` <span class="badge badge-boost">boost</span>` : ""}</td>
        <td>@${esc(e.hostUsername)}</td>
        <td>${esc(e.scenario || "")}</td>
        <td>${fmtLocal(e.startsAt)}</td>
        <td>${e.ended ? `<span class="badge">ended</span>` : `<span class="badge badge-live">live/upcoming</span>`}</td>
        <td>${e.views}</td>
        <td style="white-space:nowrap;display:flex;gap:6px">
          <button class="btn btn-ghost btn-sm" data-edit="${e.id}">Edit</button>
          ${e.ended ? "" : `<button class="btn btn-ghost btn-sm" data-end="${e.id}">End</button>`}
          <button class="btn btn-danger btn-sm" data-del="${e.id}">Delete</button>
        </td>
      </tr>`).join("")}</tbody></table>`;
    wrap.querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => startEdit(d.events.find((e) => e.id === b.dataset.edit)));
    wrap.querySelectorAll("[data-end]").forEach((b) => b.onclick = () => endEvent(b.dataset.end));
    wrap.querySelectorAll("[data-del]").forEach((b) => b.onclick = () => deleteEvent(b.dataset.del));
  } catch (e) { wrap.innerHTML = `<p class="note">${esc(e.message)}</p>`; }
}
function startEdit(e) {
  editingId = e.id;
  $("evEdit").hidden = false;
  $("eTitle").value = e.title || "";
  $("eScenario").value = e.scenario || "";
  $("eStartsAt").value = toLocalInput(e.startsAt);
  $("eDuration").value = e.durationMin || 60;
  $("eDesc").value = e.description || "";
  $("eBoosted").checked = Boolean(e.boosted);
  $("evEdit").scrollIntoView({ behavior: "smooth", block: "center" });
}
async function saveEvent() {
  if (!editingId) return;
  const body = {
    id: editingId,
    title: $("eTitle").value, scenario: $("eScenario").value,
    description: $("eDesc").value, durationMin: Number($("eDuration").value),
    boosted: $("eBoosted").checked,
  };
  const local = $("eStartsAt").value;
  if (local) body.startsAt = new Date(local).toISOString();
  try {
    await api("/api/admin?action=event-update", { method: "POST", body });
    flash($("msg"), "Event saved.", true);
    $("evEdit").hidden = true; loadEvents();
  } catch (e) { flash($("msg"), e.message); }
}
async function endEvent(id) {
  if (!confirm("End this event now? It will leave the discovery feed immediately.")) return;
  try { await api("/api/admin?action=event-end", { method: "POST", body: { id } }); flash($("msg"), "Event ended.", true); loadEvents(); }
  catch (e) { flash($("msg"), e.message); }
}
async function deleteEvent(id) {
  if (!confirm("Delete this event permanently? This cannot be undone.")) return;
  try { await api("/api/admin?action=event-delete", { method: "POST", body: { id } }); flash($("msg"), "Event deleted.", true); loadEvents(); }
  catch (e) { flash($("msg"), e.message); }
}

// ========================= USERS =========================
function wireUsers() {}
async function loadUsers() {
  const wrap = $("userTable");
  try {
    const d = await api("/api/admin?action=users");
    wrap.innerHTML = `<table class="tbl"><thead><tr>
      <th>Username</th><th>Plan</th><th>Role</th><th>Key</th><th>Status</th><th></th>
    </tr></thead><tbody>${d.users.map((u) => `
      <tr>
        <td>@${esc(u.username)}</td>
        <td>${esc(u.plan)}</td>
        <td>${u.role ? `<span class="badge badge-boost">${esc(u.role)}</span>` : "—"}</td>
        <td>${u.hasErlcKey ? "yes" : "—"}</td>
        <td>${u.suspended ? `<span class="badge badge-bad">suspended</span>` : "active"}</td>
        <td style="white-space:nowrap;display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm" data-susp="${u.id}">${u.suspended ? "Unsuspend" : "Suspend"}</button>
          ${u.hasErlcKey ? `<button class="btn btn-ghost btn-sm" data-revoke="${u.id}">Revoke key</button>` : ""}
        </td>
      </tr>`).join("")}</tbody></table>`;
    wrap.querySelectorAll("[data-susp]").forEach((b) => b.onclick = async () => {
      const u = d.users.find((x) => x.id === b.dataset.susp);
      try { await api("/api/admin?action=user-update", { method: "POST", body: { id: u.id, suspended: !u.suspended } }); loadUsers(); }
      catch (e) { flash($("msg"), e.message); }
    });
    wrap.querySelectorAll("[data-revoke]").forEach((b) => b.onclick = async () => {
      if (!confirm("Revoke this user's stored ER:LC key?")) return;
      try { await api("/api/admin?action=user-update", { method: "POST", body: { id: b.dataset.revoke, revokeErlcKey: true } }); loadUsers(); }
      catch (e) { flash($("msg"), e.message); }
    });
  } catch (e) { wrap.innerHTML = `<p class="note">${esc(e.message)}</p>`; }
}

// ========================= SITE CONTENT =========================
function wireSite() { $("saveContent").onclick = saveContent; }
async function loadContent() {
  try {
    const { content } = await api("/api/admin?action=content");
    $("heroHeadline").value = content.heroHeadline || "";
    $("heroSub").value = content.heroSub || "";
    $("announcement").value = content.announcement || "";
  } catch { /* defaults are fine */ }
}
async function saveContent() {
  const body = {
    heroHeadline: $("heroHeadline").value,
    heroSub: $("heroSub").value,
    announcement: $("announcement").value,
  };
  try { await api("/api/admin?action=content-update", { method: "POST", body }); flash($("msg"), "Homepage content saved.", true); }
  catch (e) { flash($("msg"), e.message); }
}

// ========================= EXECUTIVE =========================
function wireExec() {
  $("genCode").onclick = async () => {
    try {
      await api("/api/admin?action=code-create", { method: "POST", body: { label: $("codeLabel").value, role: $("codeRole").value } });
      $("codeLabel").value = "";
      flash($("msg"), "Code generated.", true);
      loadCodes();
    } catch (e) { flash($("msg"), e.message); }
  };
  $("setRole").onclick = async () => {
    try {
      await api("/api/admin?action=set-role", { method: "POST", body: { username: $("roleUser").value, role: $("roleSel").value } });
      flash($("msg"), "Role applied.", true);
      $("roleUser").value = "";
    } catch (e) { flash($("msg"), e.message); }
  };
}
async function loadCodes() {
  const wrap = $("codeList");
  try {
    const d = await api("/api/admin?action=codes");
    if (!d.codes.length) { wrap.innerHTML = `<p class="note">No codes yet.</p>`; return; }
    wrap.innerHTML = `<table class="tbl"><thead><tr>
      <th>Code</th><th>Label</th><th>Grants</th><th>Uses</th><th>Status</th><th></th>
    </tr></thead><tbody>${d.codes.map((c) => `
      <tr>
        <td><code class="code-chip">${esc(c.code)}</code></td>
        <td>${esc(c.label)}</td>
        <td><span class="badge badge-boost">${esc(c.role)}</span></td>
        <td title="${esc(c.redeemers.join(", "))}">${c.uses}</td>
        <td>${c.revoked ? `<span class="badge badge-bad">revoked</span>` : `<span class="badge badge-good">active</span>`}</td>
        <td>${c.revoked ? "" : `<button class="btn btn-ghost btn-sm" data-revoke-code="${esc(c.code)}">Revoke</button>`}</td>
      </tr>`).join("")}</tbody></table>`;
    wrap.querySelectorAll("[data-revoke-code]").forEach((b) => b.onclick = async () => {
      if (!confirm("Revoke this code? Existing holders keep their role, but the code stops working for new redemptions.")) return;
      try { await api("/api/admin?action=code-revoke", { method: "POST", body: { code: b.dataset.revokeCode } }); loadCodes(); }
      catch (e) { flash($("msg"), e.message); }
    });
    // tap-to-copy
    wrap.querySelectorAll(".code-chip").forEach((el) => el.onclick = () => {
      navigator.clipboard?.writeText(el.textContent).then(() => flash($("msg"), "Code copied.", true));
    });
  } catch (e) { wrap.innerHTML = `<p class="note">${esc(e.message)}</p>`; }
}
async function loadRequests() {
  const wrap = $("adminReqs");
  try {
    const d = await api("/api/admin?action=admin-requests");
    if (!d.requests.length) { wrap.innerHTML = `<p class="note">No pending requests.</p>`; return; }
    wrap.innerHTML = d.requests.map((r) => `
      <div class="req-row">
        <div><b>@${esc(r.username)}</b><div class="chat-item-sub">${esc(r.note || "No note")} · ${fmtLocal(r.at)}</div></div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-primary btn-sm" data-approve="${esc(r.userId)}">Approve</button>
          <button class="btn btn-ghost btn-sm" data-deny="${esc(r.userId)}">Deny</button>
        </div>
      </div>`).join("");
    wrap.querySelectorAll("[data-approve]").forEach((b) => b.onclick = async () => {
      try { await api("/api/admin?action=approve-request", { method: "POST", body: { userId: b.dataset.approve } }); flash($("msg"), "Approved as admin.", true); loadRequests(); }
      catch (e) { flash($("msg"), e.message); }
    });
    wrap.querySelectorAll("[data-deny]").forEach((b) => b.onclick = async () => {
      try { await api("/api/admin?action=deny-request", { method: "POST", body: { userId: b.dataset.deny } }); loadRequests(); }
      catch (e) { flash($("msg"), e.message); }
    });
  } catch (e) { wrap.innerHTML = `<p class="note">${esc(e.message)}</p>`; }
}

// ========================= AUDIT =========================
function wireAudit() { $("loadAudit").onclick = loadAudit; }
async function loadAudit() {
  const wrap = $("auditOut");
  wrap.innerHTML = `<p class="note">Loading…</p>`;
  try {
    const d = await api("/api/admin?action=audit");
    if (!d.entries.length) { wrap.innerHTML = `<p class="note">No entries.</p>`; return; }
    wrap.innerHTML = `<table class="tbl"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th></tr></thead>
      <tbody>${d.entries.map((e) => `
        <tr>
          <td style="white-space:nowrap">${fmtLocal(e.at)}</td>
          <td>${e.actor ? "@" + esc(e.actor.username) : "—"}</td>
          <td><code class="code-chip">${esc(e.action)}</code></td>
          <td style="font-size:.8rem">${esc(JSON.stringify(e.detail))}</td>
        </tr>`).join("")}</tbody></table>`;
  } catch (e) { wrap.innerHTML = `<p class="note">${esc(e.message)}</p>`; }
}

// ---------- helpers ----------
function toLocalInput(iso) {
  const d = new Date(iso); const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
