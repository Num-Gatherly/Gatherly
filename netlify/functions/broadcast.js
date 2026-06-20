// /api/broadcast - Discord DM broadcast system.
//
// action=unsubscribe   GET,  public, no login (signed token from the DM link)
// action=test          POST, executive only, DMs the caller-supplied Discord ID
// action=send          POST, executive only, DMs every connected, subscribed user
// action=runs          GET,  executive only, recent broadcast history
import {
  json, requireUser, isExec, clampStr, guard, audit,
} from "../lib/util.js";
import {
  verifyUnsubToken, setUnsubscribed, sendBroadcastTest, sendBroadcastToAll,
  listBroadcastRuns, allConnectedUsers, isUnsubscribed,
} from "../lib/broadcast.js";

export default async (req) => {
  try { return await handler(req); }
  catch (e) { return json({ error: "Server error: " + (e?.message || "unknown") }, 500); }
};

async function handler(req) {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  /* ----------------------- public: unsubscribe link ----------------------- */
  if (action === "unsubscribe" && req.method === "GET") {
    const token = url.searchParams.get("token") || "";
    const userId = verifyUnsubToken(token);
    if (!userId) return unsubPage("That unsubscribe link is invalid or has expired.", false);
    const ok = await setUnsubscribed(userId, true);
    if (!ok) return unsubPage("We could not find that account. It may have been deleted.", false);
    await audit(null, "broadcast.unsubscribe", { targetId: userId });
    return unsubPage("You have been unsubscribed from Gatherly product update DMs.", true);
  }

  if (action === "resubscribe" && req.method === "GET") {
    const token = url.searchParams.get("token") || "";
    const userId = verifyUnsubToken(token);
    if (!userId) return unsubPage("That link is invalid or has expired.", false);
    const ok = await setUnsubscribed(userId, false);
    if (!ok) return unsubPage("We could not find that account. It may have been deleted.", false);
    await audit(null, "broadcast.resubscribe", { targetId: userId });
    return unsubPage("You are resubscribed to Gatherly product update DMs.", true);
  }

  /* ------------------------------ staff gate ------------------------------ */
  const user = await requireUser(req);
  if (!isExec(user)) return json({ error: "Not found." }, 404);

  if (action === "runs" && req.method === "GET") {
    const runs = await listBroadcastRuns();
    const users = await allConnectedUsers();
    return json({
      runs,
      connectedCount: users.length,
      unsubscribedCount: users.filter(isUnsubscribed).length,
    });
  }

  if (action === "test" && req.method === "POST") {
    const blocked = await guard(req, user, `bcast-test:${user.id}`, 10, 600, {
      kind: "broadcast-test-flood",
      what: "Repeated broadcast test sends.",
      risk: "Possible misuse of the executive DM broadcast test endpoint.",
    });
    if (blocked) return blocked;

    const b = await req.json().catch(() => ({}));
    const testDiscordId = clampStr(b.testDiscordId, 32).replace(/\D/g, "");
    if (!testDiscordId) return json({ error: "Enter a valid Discord user ID to test with." }, 400);

    const formInput = parseFormInput(b);
    if (!formInput.title) return json({ error: "Title is required." }, 400);

    const r = await sendBroadcastTest(formInput, testDiscordId, user);
    if (!r.ok) {
      return json({ error: testFailureReason(r.reason) }, 400);
    }
    return json({ ok: true });
  }

  if (action === "send" && req.method === "POST") {
    const blocked = await guard(req, user, `bcast-send:${user.id}`, 3, 3600, {
      kind: "broadcast-send-flood",
      what: "More than 3 mass DM broadcasts sent in one hour.",
      risk: "Possible compromised executive account spamming every Gatherly user.",
    });
    if (blocked) return blocked;

    const b = await req.json().catch(() => ({}));
    if (b.confirm !== true) {
      return json({ error: "Confirmation required. This sends a DM to every connected Gatherly user." }, 400);
    }
    const formInput = parseFormInput(b);
    if (!formInput.title) return json({ error: "Title is required." }, 400);

    const run = await sendBroadcastToAll(formInput, user);
    return json({ ok: true, run });
  }

  return json({ error: "Unknown action." }, 404);
}

function parseFormInput(b) {
  return {
    title: clampStr(b.title, 256),
    body: clampStr(b.body, 3500),
    image: clampStr(b.image, 400),
    changeLogText: clampStr(b.changeLogText, 80),
    changeLogUrl: clampStr(b.changeLogUrl, 400),
  };
}

function testFailureReason(reason) {
  if (reason === "dm-blocked") return "Could not DM that ID. They must share a server with the Gatherly bot and allow DMs from server members.";
  if (reason === "bot-not-configured") return "DISCORD_BOT_TOKEN is not set on the server.";
  if (reason && reason.startsWith("discord-")) return `Discord rejected the message (status ${reason.split("-")[1]}). Check the title, body length, and image URL.`;
  return "Could not send the test DM. Check the Discord ID and try again.";
}

/* ------------------------- tiny unsubscribe page ------------------------- */
function unsubPage(message, ok) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gatherly</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    background:#0b0d12;color:#f4f6fb;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Inter,sans-serif}
  .card{max-width:420px;margin:24px;padding:32px;border-radius:16px;background:#11141c;
    border:1px solid rgba(255,255,255,.08);text-align:center}
  .dot{width:40px;height:40px;border-radius:50%;margin:0 auto 16px;display:flex;align-items:center;
    justify-content:center;font-size:20px;background:${ok ? "rgba(105,217,156,.15)" : "rgba(255,122,122,.15)"};
    color:${ok ? "#69d99c" : "#ff7a7a"}}
  p{line-height:1.5;color:#c7cdda}
  a{color:#7fa8ff;text-decoration:none}
</style></head>
<body><div class="card"><div class="dot">${ok ? "✓" : "!"}</div><p>${escapeHtml(message)}</p>
<p><a href="/">Return to Gatherly</a></p></div></body></html>`;
  return new Response(html, { status: ok ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
