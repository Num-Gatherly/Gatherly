// /api/tickets - support tickets with two-way Discord relay.
import { json, ticketsStore, requireUser, id, postDiscordWebhook, auditError } from "../lib/util.js";

const isStaff = (u) => u && (u.role === "admin" || u.role === "executive");
const SUPPORT_CHANNEL_ID = process.env.SUPPORT_CHANNEL_ID || "1515235842292187246";

async function fetchT(url, opts = {}, ms = 8000) { return fetch(url, { ...opts, signal: AbortSignal.timeout(ms) }); }

async function allTickets() {
  const store = ticketsStore();
  const { blobs } = await store.list();
  const items = await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })));
  return items.filter(Boolean);
}

const SAFE = (t) => ({ id: t.id, userId: t.userId, username: t.username, topic: t.topic, subject: t.subject, status: t.status, createdAt: t.createdAt, updatedAt: t.updatedAt, messages: t.messages, assignedTo: t.assignedTo || null, assignedToName: t.assignedToName || null });

async function postToSupportChannel(ticket, messageText, fromLabel) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return { ok: false };
  try {
    const embed = { title: `Ticket #${ticket.id.slice(0, 8)} · ${ticket.subject}`, description: messageText.slice(0, 1800), color: 0x7fa8ff,
      fields: [{ name: "From", value: fromLabel, inline: true }, { name: "Topic", value: ticket.topic, inline: true }, { name: "Status", value: ticket.status, inline: true }, { name: "Ticket ID", value: ticket.id, inline: false }],
      timestamp: new Date().toISOString(), footer: { text: "Reply from the Gatherly control room. The user receives staff replies as a bot DM." } };
    const r = await fetchT(`https://discord.com/api/v10/channels/${SUPPORT_CHANNEL_ID}/messages`, { method: "POST", headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ embeds: [embed] }) });
    return { ok: r.ok };
  } catch { return { ok: false }; }
}

async function dmUser(discordId, messageText, subject) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token || !discordId) return { ok: false };
  try {
    const H = { Authorization: `Bot ${token}`, "Content-Type": "application/json" };
    const ch = await fetchT("https://discord.com/api/v10/users/@me/channels", { method: "POST", headers: H, body: JSON.stringify({ recipient_id: discordId }) });
    if (!ch.ok) return { ok: false };
    const { id: channelId } = await ch.json();
    const r = await fetchT(`https://discord.com/api/v10/channels/${channelId}/messages`, { method: "POST", headers: H, body: JSON.stringify({ embeds: [{ title: `Support reply: ${subject}`, description: messageText.slice(0, 1800), color: 0x7fa8ff, timestamp: new Date().toISOString(), footer: { text: "Gatherly Support · reply at gatherly-events.netlify.app/contact" } }] }) });
    return { ok: r.ok };
  } catch { return { ok: false }; }
}

export default async (req) => {
  try { return await handler(req); }
  catch (e) { try { await auditError(null, "tickets.crash", e?.message || "unknown"); } catch {} return json({ error: "Server error: " + (e?.message || "unknown") }, 500); }
};

async function handler(req) {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  const store = ticketsStore();

  const user = await requireUser(req);
  if (!user) return json({ error: "Log in to use support." }, 401);

  if (action === "create" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    if (b.website) return json({ ok: true });
    if (!b.topic || !b.subject || !b.message) return json({ error: "Topic, subject, and message are all required." }, 400);
    const t = {
      id: id(), userId: user.id, username: user.username, discordId: user.discordId,
      topic: String(b.topic).slice(0, 40), subject: String(b.subject).slice(0, 100), status: "open",
      assignedTo: null, assignedToName: null,
      messages: [{ from: "user", by: user.username, text: String(b.message).slice(0, 2000), at: new Date().toISOString() }],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    await store.setJSON(t.id, t);
    const posted = await postToSupportChannel(t, t.messages[0].text, `@${user.username}`);
    if (!posted.ok && process.env.STAFF_DISCORD_WEBHOOK) {
      await postDiscordWebhook(process.env.STAFF_DISCORD_WEBHOOK, { username: "Gatherly Support", embeds: [{ title: `New ticket: ${t.subject}`, description: t.messages[0].text.slice(0, 500), color: 0x7fa8ff, fields: [{ name: "From", value: `@${t.username}`, inline: true }, { name: "Topic", value: t.topic, inline: true }, { name: "ID", value: t.id, inline: true }], timestamp: t.createdAt }] });
    }
    return json({ ok: true, ticket: SAFE(t), delivered: posted.ok });
  }

  if (action === "mine") {
    const items = (await allTickets()).filter((t) => t.userId === user.id).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    return json({ tickets: items.map(SAFE) });
  }

  if (action === "get") {
    const t = await store.get(url.searchParams.get("id"), { type: "json" });
    if (!t) return json({ error: "Ticket not found." }, 404);
    if (t.userId !== user.id && !isStaff(user)) return json({ error: "Not found." }, 404);
    return json({ ticket: SAFE(t) });
  }

  if (action === "reply" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const ticketId = b.id || url.searchParams.get("id");
    const text = String(b.message || "").slice(0, 2000);
    if (!text) return json({ error: "Message is required." }, 400);
    const t = await store.get(ticketId, { type: "json" });
    if (!t) return json({ error: "Ticket not found." }, 404);
    if (t.userId !== user.id && !isStaff(user)) return json({ error: "Not found." }, 404);
    if (t.status === "closed" && !isStaff(user)) return json({ error: "This ticket is closed." }, 400);
    const fromStaff = isStaff(user);
    t.messages.push({ from: fromStaff ? "staff" : "user", by: user.username, text, at: new Date().toISOString() });
    t.updatedAt = new Date().toISOString();
    await store.setJSON(ticketId, t);
    if (fromStaff) {
      if (t.discordId) await dmUser(t.discordId, `${user.username} (Gatherly Staff): ${text}`, t.subject);
      await postToSupportChannel(t, `Staff reply from ${user.username}: ${text}`, `@${user.username}`);
    } else {
      await postToSupportChannel(t, `User reply from ${user.username}: ${text}`, `@${user.username}`);
    }
    return json({ ok: true, ticket: SAFE(t) });
  }

  if ((action === "close" || action === "reopen") && req.method === "POST") {
    if (!isStaff(user)) return json({ error: "Staff only." }, 403);
    const b = await req.json().catch(() => ({}));
    const t = await store.get(b.id, { type: "json" });
    if (!t) return json({ error: "Ticket not found." }, 404);
    t.status = action === "close" ? "closed" : "open";
    t.updatedAt = new Date().toISOString();
    await store.setJSON(t.id, t);
    if (action === "close" && t.discordId) await dmUser(t.discordId, `Your ticket "${t.subject}" has been resolved and closed. Open a new ticket any time at gatherly-events.netlify.app/contact`, t.subject);
    return json({ ok: true, ticket: SAFE(t) });
  }

  if (action === "assign" && req.method === "POST") {
    if (!isStaff(user)) return json({ error: "Staff only." }, 403);
    const b = await req.json().catch(() => ({}));
    const t = await store.get(b.id, { type: "json" });
    if (!t) return json({ error: "Not found." }, 404);
    t.assignedTo = user.id; t.assignedToName = user.username; t.updatedAt = new Date().toISOString();
    await store.setJSON(t.id, t);
    return json({ ok: true });
  }

  if (action === "list") {
    if (!isStaff(user)) return json({ error: "Staff only." }, 403);
    const status = url.searchParams.get("status") || "open";
    const items = (await allTickets()).filter((t) => t.status === status).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    return json({ tickets: items.map(SAFE) });
  }

  if (action === "counts") {
    if (!isStaff(user)) return json({ open: 0, closed: 0 });
    const items = await allTickets();
    return json({ open: items.filter((t) => t.status === "open").length, closed: items.filter((t) => t.status === "closed").length });
  }

  return json({ error: "Unknown action." }, 404);
}
