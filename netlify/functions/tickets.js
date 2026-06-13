// /api/tickets - support tickets. Website side of the two-way Discord relay.
//
// Gate to open a ticket: must be logged in, NOT support-blacklisted, and a member
// of the Gatherly Discord. Staff replies DM the opener (with Reply/Escalate buttons);
// the opener's DM replies come back through /api/interactions.
import {
  json, ticketsStore, requireUser, id, auditError, guard, clampStr,
  isStaff, isGuildMember, isSupportBlacklisted, effectivePlan,
} from "../lib/util.js";
import {
  getTicket, saveTicket, allTickets, sortForFeed, SAFE, appendMessage,
  sendChannelCard, refreshChannelCard, postChannelNote, dmOpened, dmStaffReply, dmResolved,
} from "../lib/support.js";

const INVITE = process.env.GATHERLY_INVITE || "https://discord.gg/x3Fv8JSenY";

export default async (req) => {
  try { return await handler(req); }
  catch (e) { try { await auditError(null, "tickets.crash", e?.message || "unknown"); } catch {} return json({ error: "Server error: " + (e?.message || "unknown") }, 500); }
};

async function handler(req) {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  const user = await requireUser(req);
  if (!user) return json({ error: "Log in to use support." }, 401);

  // Lets the support page decide whether to show the form, the join prompt,
  // or the blacklist screen. Never trusted on its own; create re-checks.
  if (action === "precheck") {
    const member = await isGuildMember(user.discordId); // true / false / null(unknown)
    return json({ blacklisted: isSupportBlacklisted(user), member, invite: INVITE });
  }

  if (action === "create" && req.method === "POST") {
    if (isSupportBlacklisted(user)) return json({ error: "You have been blacklisted from opening a support ticket.", blacklisted: true }, 403);

    const member = await isGuildMember(user.discordId);
    if (member === false) return json({ error: `Join the Gatherly Discord before opening a ticket: ${INVITE}`, needJoin: true, invite: INVITE }, 403);

    const blocked = await guard(req, user, `ticket-create:${user.id}`, 3, 600, { kind: "ticket-spam", what: "Rapid ticket creation.", risk: "Possible spamming of the support queue." });
    if (blocked) return blocked;

    const b = await req.json().catch(() => ({}));
    if (b.website) return json({ ok: true }); // honeypot
    if (!b.topic || !b.subject || !b.message) return json({ error: "Topic, subject, and message are all required." }, 400);

    const t = {
      id: id(), userId: user.id, username: user.username, discordId: user.discordId,
      topic: clampStr(b.topic, 40), subject: clampStr(b.subject, 100),
      status: "open", escalated: false, plan: effectivePlan(user),
      assignedTo: null, assignedToName: null, channelMessageId: null, channelId: null,
      messages: [{ from: "user", text: clampStr(b.message, 2000), at: new Date().toISOString() }],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const card = await sendChannelCard(t);
    if (card.ok) { t.channelMessageId = card.messageId; t.channelId = card.channelId; }
    await saveTicket(t);
    const dm = await dmOpened(t);
    return json({ ok: true, ticket: SAFE(t), delivered: card.ok, dmDelivered: dm.ok });
  }

  if (action === "mine") {
    const items = (await allTickets()).filter((t) => t.userId === user.id).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    return json({ tickets: items.map(SAFE) });
  }

  if (action === "get") {
    const t = await getTicket(url.searchParams.get("id"));
    if (!t) return json({ error: "Ticket not found." }, 404);
    if (t.userId !== user.id && !isStaff(user)) return json({ error: "Not found." }, 404);
    return json({ ticket: SAFE(t) });
  }

  if (action === "reply" && req.method === "POST") {
    const blocked = await guard(req, user, `ticket-reply:${user.id}`, 12, 120, { kind: "ticket-spam", what: "Rapid ticket replies.", risk: "Possible flooding of a support thread." });
    if (blocked) return blocked;
    const b = await req.json().catch(() => ({}));
    const ticketId = b.id || url.searchParams.get("id");
    const text = clampStr(b.message, 2000);
    if (!text) return json({ error: "Message is required." }, 400);
    const t = await getTicket(ticketId);
    if (!t) return json({ error: "Ticket not found." }, 404);
    const staff = isStaff(user);
    if (t.userId !== user.id && !staff) return json({ error: "Not found." }, 404);
    if (t.status === "closed" && !staff) return json({ error: "This ticket is closed." }, 400);

    appendMessage(t, staff ? "staff" : "user", text);
    await saveTicket(t);
    if (staff) {
      await dmStaffReply(t, text);                 // no staff name, no URL
      await postChannelNote(t, `> Staff reply sent to the user.`);
    } else {
      await postChannelNote(t, `> New reply from the user:\n${text.slice(0, 800)}`);
      await refreshChannelCard(t);
    }
    return json({ ok: true, ticket: SAFE(t) });
  }

  if (action === "escalate" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const t = await getTicket(b.id || url.searchParams.get("id"));
    if (!t) return json({ error: "Ticket not found." }, 404);
    if (t.userId !== user.id && !isStaff(user)) return json({ error: "Not found." }, 404);
    t.escalated = true; t.escalatedAt = new Date().toISOString(); t.updatedAt = t.escalatedAt;
    await saveTicket(t);
    await postChannelNote(t, "> This ticket was marked **high urgency**.");
    await refreshChannelCard(t);
    return json({ ok: true, ticket: SAFE(t) });
  }

  // ---- staff only below ----
  if (action === "assign" && req.method === "POST") {
    if (!isStaff(user)) return json({ error: "Staff only." }, 403);
    const b = await req.json().catch(() => ({}));
    const t = await getTicket(b.id);
    if (!t) return json({ error: "Not found." }, 404);
    t.assignedTo = user.id; t.assignedToName = user.username; t.updatedAt = new Date().toISOString();
    await saveTicket(t);
    await refreshChannelCard(t);
    return json({ ok: true, ticket: SAFE(t) });
  }

  if (action === "unassign" && req.method === "POST") {
    if (!isStaff(user)) return json({ error: "Staff only." }, 403);
    const b = await req.json().catch(() => ({}));
    const t = await getTicket(b.id);
    if (!t) return json({ error: "Not found." }, 404);
    t.assignedTo = null; t.assignedToName = null; t.updatedAt = new Date().toISOString();
    await saveTicket(t);
    await refreshChannelCard(t);
    return json({ ok: true, ticket: SAFE(t) });
  }

  if ((action === "close" || action === "reopen") && req.method === "POST") {
    if (!isStaff(user)) return json({ error: "Staff only." }, 403);
    const b = await req.json().catch(() => ({}));
    const t = await getTicket(b.id);
    if (!t) return json({ error: "Ticket not found." }, 404);
    t.status = action === "close" ? "closed" : "open";
    if (action === "reopen") t.escalated = false;
    t.updatedAt = new Date().toISOString();
    await saveTicket(t);
    await refreshChannelCard(t);
    if (action === "close") await dmResolved(t);
    return json({ ok: true, ticket: SAFE(t) });
  }

  if (action === "list") {
    if (!isStaff(user)) return json({ error: "Staff only." }, 403);
    const status = url.searchParams.get("status") || "open";
    const items = sortForFeed((await allTickets()).filter((t) => t.status === status));
    return json({ tickets: items.map(SAFE) });
  }

  if (action === "counts") {
    if (!isStaff(user)) return json({ open: 0, closed: 0 });
    const items = await allTickets();
    return json({ open: items.filter((t) => t.status === "open").length, closed: items.filter((t) => t.status === "closed").length, escalated: items.filter((t) => t.status === "open" && t.escalated).length });
  }

  return json({ error: "Unknown action." }, 404);
}
