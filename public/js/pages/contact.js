import { boot, api, esc, currentUser } from "/js/app.js";
boot("/contact");

const $ = (id) => document.getElementById(id);
const root = () => $("supportRoot");
const INVITE_FALLBACK = "https://discord.gg/x3Fv8JSenY";

const TOPICS = ["Billing", "Reports not generating", "Listing or content issue", "Account or data request", "Plan enquiry", "Something else"];

function formMarkup(prefillName = "") {
  return `
    <div class="card">
      <div id="msg"></div>
      <label class="field">Your exact Discord name <small>So our team can reach you. Prefilled when you're logged in.</small>
        <input id="from" maxlength="60" autocomplete="off" placeholder="your_discord_username" value="${esc(prefillName)}">
      </label>
      <label class="field">Topic
        <select id="topic">${TOPICS.map((t) => `<option>${t}</option>`).join("")}</select>
      </label>
      <label class="field">Subject <small>A short summary.</small>
        <input id="subject" maxlength="100" autocomplete="off" placeholder="Brief summary of your issue">
      </label>
      <label class="field">Message
        <textarea id="body" rows="5" maxlength="1500"></textarea>
      </label>
      <input class="hp" id="website" tabindex="-1" autocomplete="off" aria-hidden="true">
      <button class="btn btn-primary" id="send">Send message</button>
      <p class="note" style="margin-top:10px">Our team replies in your Discord DMs from the Gatherly bot. You can reply right inside that DM. Please be patient and avoid sending repeated messages.</p>
    </div>`;
}

function loginGate() {
  root().innerHTML = `
    <div class="card" style="text-align:center">
      <h3>Log in to open a request</h3>
      <p style="margin:8px 0 16px">So we can reply to you and keep your requests in one place.</p>
      <a class="btn btn-primary" href="/api/auth?action=start">Continue with Discord</a>
    </div>`;
}

function joinGate(invite) {
  root().innerHTML = `
    <div class="card" style="text-align:center">
      <h3>Join the Gatherly Discord first</h3>
      <p style="margin:8px 0 16px;max-width:440px;margin-left:auto;margin-right:auto">Support runs through our Discord so the bot can DM you. Join, then come back and recheck.</p>
      <a class="btn btn-primary" href="${esc(invite)}" target="_blank" rel="noopener">Join the Discord</a>
      <button class="btn btn-ghost btn-sm" id="recheck" style="margin-left:8px">I've joined, recheck</button>
    </div>`;
  $("recheck").onclick = init;
}

function blacklistGate(invite) {
  // Glass, blue-tinted screen over a blurred dummy form.
  root().innerHTML = `
    <div style="position:relative;border-radius:18px;overflow:hidden">
      <div style="filter:blur(7px);pointer-events:none;opacity:.45" aria-hidden="true">${formMarkup("")}</div>
      <div class="blacklist-screen" style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:32px;
        background:linear-gradient(160deg,rgba(40,90,210,.22),rgba(20,40,90,.32));backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);
        border:1px solid rgba(120,165,255,.35);border-radius:18px;box-shadow:0 8px 40px rgba(40,90,210,.25) inset">
        <div style="font-size:2rem;margin-bottom:6px">&#128274;</div>
        <h3 style="color:#dbe6ff">You have been blacklisted from opening a support ticket</h3>
        <p style="margin:10px auto 0;max-width:420px;color:#aebfe6">If you believe this is an error, open a ticket in our
          <a href="${esc(invite)}" target="_blank" rel="noopener" style="color:#9fc0ff;text-decoration:underline">Discord</a>.</p>
      </div>
    </div>`;
}

function showForm(prefillName) {
  root().innerHTML = formMarkup(prefillName);
  $("send").addEventListener("click", submit);
  renderMine();
}

const say = (text, ok = false) => { const m = $("msg"); if (m) m.innerHTML = `<div class="alert ${ok ? "alert-ok" : "alert-err"}">${ok ? text : esc(text)}</div>`; };

async function submit() {
  if ($("website").value) return;
  const topic = $("topic").value;
  const subject = ($("subject")?.value || topic).trim();
  const message = $("body").value.trim();
  if (!message) return say("Type your message first.");
  $("send").disabled = true;
  say("Sending your request to the team&hellip;", true);
  try {
    const d = await api("/api/tickets?action=create", { method: "POST", body: { topic, subject, message, website: $("website").value } });
    say(`Sent. Our team will reply in your Discord DMs from the Gatherly bot${d.dmDelivered ? "" : " (make sure you share a server with the bot and allow DMs from server members)"}. You can reply inside that DM. Please be patient and avoid sending repeated messages.`, true);
    $("body").value = "";
    renderMine();
  } catch (e) {
    if (e.message && /blacklist/i.test(e.message)) return init();
    if (e.message && /join the gatherly/i.test(e.message)) return joinGate(INVITE_FALLBACK);
    if (/log in/i.test(e.message)) say(`You need to log in first. <a href="/api/auth?action=start">Continue with Discord</a>`, false);
    else say(e.message);
  } finally { if ($("send")) $("send").disabled = false; }
}

async function renderMine() {
  const box = $("mine");
  if (!box) return;
  try {
    const d = await api("/api/tickets?action=mine");
    if (!d.tickets || !d.tickets.length) { box.innerHTML = `<p class="note">No requests yet.</p>`; return; }
    box.innerHTML = d.tickets.slice(0, 8).map((t) => {
      const last = t.messages?.[t.messages.length - 1];
      const dot = t.status === "closed" ? "#9aa4b2" : t.escalated ? "#ffcf5c" : t.assignedTo ? "#69d99c" : "#ff7a7a";
      return `<div class="card" style="padding:12px 14px;margin-bottom:8px">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="width:9px;height:9px;border-radius:50%;background:${dot};display:inline-block"></span>
          <b>${esc(t.subject)}</b>
          <span class="note" style="margin-left:auto">${t.status === "closed" ? "Resolved" : t.assignedTo ? "Being handled" : "Open"}</span>
        </div>
        ${last ? `<p class="note" style="margin-top:6px">${last.from === "staff" ? "Team: " : "You: "}${esc(last.text.slice(0, 160))}</p>` : ""}
      </div>`;
    }).join("");
  } catch { box.innerHTML = ""; }
}

async function init() {
  let me = null;
  try { const d = await api("/api/auth?action=me"); me = d.user; } catch {}
  if (!me) return loginGate();
  try {
    const pc = await api("/api/tickets?action=precheck");
    const invite = pc.invite || INVITE_FALLBACK;
    if (pc.blacklisted) return blacklistGate(invite);
    if (pc.member === false) return joinGate(invite);
    showForm(me.username || "");
  } catch (e) {
    if (/log in/i.test(e.message || "")) return loginGate();
    showForm(me.username || ""); // precheck unavailable, allow the form; create re-checks
  }
}

init();
