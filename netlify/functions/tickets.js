// /api/tickets - support tickets with chat threads.
//
//   USER  : create, mine, get, reply
//   STAFF : list (open/closed), reply, close, counts
//
// New-ticket notifications can ping a staff Discord channel via the optional
// STAFF_DISCORD_WEBHOOK env var. The admin panel also polls counts.

import { json, ticketsStore, requireUser, id, postDiscordWebhook } from "../lib/util.js";

const isStaff = (u) => u && (u.role === "admin" || u.role === "executive");

async function allTickets() {
  const store = ticketsStore();
  const { blobs } = await store.list();
  const items = await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })));
  return items.filter(Boolean);
}

const SAFE = (t) => ({
  id: t.id, userId: t.userId, username: t.username, topic: t.topic,
  subject: t.subject, status: t.status, createdAt: t.createdAt,
  updatedAt: t.updatedAt, messages: t.messages,
});

export default async (req) => {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  const store = ticketsStore();

  const user = await requireUser(req);
  if (!user) return json({ error: "Log in to use support tickets." }, 401);

  // ---- create a ticket ----
  if (action === "create" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    if (!b.topic || !b.subject || !b.message) {
      return json({ error: "Topic, subject, and message are all required." }, 400);
    }
    const t = {
      id: id(),
      userId: user.id,
      username: user.username,
      topic: String(b.topic).slice(0, 40),
      subject: String(b.subject).slice(0, 100),
      status: "open",
      messages: [{ from: "user", by: user.username, text: String(b.message).slice(0, 2000), at: new Date().toISOString() }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await store.setJSON(t.id, t);
    if (process.env.STAFF_DISCORD_WEBHOOK) {
      postDiscordWebhook(process.env.STAFF_DISCORD_WEBHOOK, {
        username: "Gatherly Support",
        embeds: [{
          title: `New ticket: ${t.subject}`,
          description: t.messages[0].text.slice(0, 500),
          color: 0x7fa8ff,
          fields: [{ name: "From", value: `@${t.username}`, inline: true }, { name: "Topic", value: t.topic, inline: true }],
          timestamp: t.createdAt,
        }],
      });
    }
    return json({ ok: true, ticket: SAFE(t) });
  }

  // ---- my tickets ----
  if (action === "mine") {
    const items = (await allTickets()).filter((t) => t.userId === user.id)
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    return json({ tickets: items.map(SAFE) });
  }

  // ---- fetch one (owner or staff) - used for chat polling ----
  if (action === "get") {
    const t = await store.get(url.searchParams.get("id") || "", { type: "json" });
    if (!t) return json({ error: "Ticket not found." }, 404);
    if (t.userId !== user.id && !isStaff(user)) return json({ error: "Not your ticket." }, 403);
    return json({ ticket: SAFE(t) });
  }

  // ---- reply (owner or staff; closed tickets are read-only) ----
  if (action === "reply" && req.method === "POST") {
    const t = await store.get(url.searchParams.get("id") || "", { type: "json" });
    if (!t) return json({ error: "Ticket not found." }, 404);
    if (t.userId !== user.id && !isStaff(user)) return json({ error: "Not your ticket." }, 403);
    if (t.status === "closed") return json({ error: "This ticket is closed." }, 400);
    const b = await req.json().catch(() => ({}));
    if (!b.text) return json({ error: "Message text required." }, 400);
    t.messages.push({
      from: t.userId === user.id ? "user" : "staff",
      by: user.username,
      text: String(b.text).slice(0, 2000),
      at: new Date().toISOString(),
    });
    t.updatedAt = new Date().toISOString();
    await store.setJSON(t.id, t);
    return json({ ok: true, ticket: SAFE(t) });
  }

  // ---- staff: list & counts & close ----
  if (action === "list") {
    if (!isStaff(user)) return json({ error: "Staff only." }, 403);
    const status = url.searchParams.get("status") || "open";
    const items = (await allTickets()).filter((t) => t.status === status)
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    return json({ tickets: items.map(SAFE) });
  }

  if (action === "counts") {
    if (!isStaff(user)) return json({ error: "Staff only." }, 403);
    const items = await allTickets();
    return json({ open: items.filter((t) => t.status === "open").length });
  }

  if (action === "close" && req.method === "POST") {
    if (!isStaff(user)) return json({ error: "Only staff can close tickets." }, 403);
    const t = await store.get(url.searchParams.get("id") || "", { type: "json" });
    if (!t) return json({ error: "Ticket not found." }, 404);
    t.status = "closed";
    t.messages.push({ from: "staff", by: user.username, text: "- Ticket closed -", at: new Date().toISOString() });
    t.updatedAt = new Date().toISOString();
    await store.setJSON(t.id, t);
    return json({ ok: true, ticket: SAFE(t) });
  }

  return json({ error: "Unknown action." }, 404);
};
