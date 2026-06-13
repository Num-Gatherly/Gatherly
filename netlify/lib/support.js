// Shared support helpers used by /api/tickets and /api/interactions.
// Keeps all the embed styling and Discord plumbing in one place.
import {
  ticketsStore, usersStore, BRAND, discordBotFetch, dmUserEmbed,
  isStaff, effectivePlan, planName,
} from "./util.js";

export const SUPPORT_CHANNEL_ID = process.env.SUPPORT_CHANNEL_ID || "1515235842292187246";
const PLAN_RANK = { ultra: 2, pro: 1, free: 0 };

/* ----------------------------- ticket store ----------------------------- */
export const getTicket = (id) => ticketsStore().get(id, { type: "json" });
export const saveTicket = (t) => ticketsStore().setJSON(t.id, t);

export async function allTickets() {
  const store = ticketsStore();
  const { blobs } = await store.list();
  const items = await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })));
  return items.filter(Boolean);
}

// Sort for the staff feed: escalated first, then higher plans, then most recent.
export function sortForFeed(items) {
  return items.sort((a, b) => {
    if (Boolean(b.escalated) !== Boolean(a.escalated)) return b.escalated ? 1 : -1;
    const pr = (PLAN_RANK[b.plan] || 0) - (PLAN_RANK[a.plan] || 0);
    if (pr) return pr;
    return new Date(b.updatedAt) - new Date(a.updatedAt);
  });
}

export const SAFE = (t) => ({
  id: t.id, userId: t.userId, username: t.username, topic: t.topic, subject: t.subject,
  status: t.status, escalated: Boolean(t.escalated), plan: t.plan || "free",
  assignedTo: t.assignedTo || null, assignedToName: t.assignedToName || null,
  createdAt: t.createdAt, updatedAt: t.updatedAt, messages: t.messages,
});

export function appendMessage(t, from, text) {
  t.messages = t.messages || [];
  t.messages.push({ from, text: String(text).slice(0, 2000), at: new Date().toISOString() });
  t.updatedAt = new Date().toISOString();
  return t;
}

/* ------------------------------- embeds --------------------------------- */
const thumb = { url: BRAND.logo };

// Message shown in the staff support channel. Colour reflects state.
export function channelEmbed(t) {
  const color = t.status === "closed" ? 0x9aa4b2 : t.escalated ? BRAND.yellow : t.assignedTo ? BRAND.green : BRAND.red;
  const statusText = t.status === "closed" ? "Closed" : t.escalated ? "Escalated (high urgency)" : t.assignedTo ? `Claimed by ${t.assignedToName}` : "Open, unclaimed";
  const first = (t.messages?.find((m) => m.from === "user")?.text || "").slice(0, 1000);
  return {
    title: `Gatherly Support`,
    color,
    thumbnail: thumb,
    description: [
      `### ${t.subject}`,
      `> ${first || "No message provided."}`,
      "",
      `- Topic: ${t.topic}`,
      `- Plan: ${planName(t.plan || "free")}`,
      `- Status: ${statusText}`,
      `- Ticket: \`${t.id}\``,
    ].join("\n"),
    timestamp: new Date().toISOString(),
    footer: { text: "Gatherly Support" },
  };
}

export function channelComponents(t) {
  if (t.status === "closed") return [];
  return [{
    type: 1,
    components: [
      { type: 2, style: 3, label: "Claim",    custom_id: `tkt:claim:${t.id}` },
      { type: 2, style: 2, label: "Unclaim",  custom_id: `tkt:unclaim:${t.id}` },
      { type: 2, style: 4, label: "Close",    custom_id: `tkt:close:${t.id}` },
      { type: 2, style: 1, label: "Escalate", custom_id: `tkt:esc:${t.id}` },
    ],
  }];
}

// Buttons attached to the user's DM so they can reply or escalate without leaving Discord.
export function dmComponents(t) {
  return [{
    type: 1,
    components: [
      { type: 2, style: 1, label: "Reply",    custom_id: `tkt:reply:${t.id}` },
      { type: 2, style: 4, label: "Escalate", custom_id: `tkt:esc:${t.id}` },
    ],
  }];
}

// First DM to the opener confirming the ticket exists. No staff name, no links.
export function dmOpenedEmbed(t) {
  return {
    title: "Gatherly Support",
    color: BRAND.color,
    thumbnail: thumb,
    description: [
      "Thanks for reaching out. Our team has your request and will respond here.",
      "",
      "### Your inquiry",
      `> ${t.subject}`,
      "",
      "- A member of our team will reply soon.",
      "- Please be patient and avoid sending repeated messages.",
      "- Use the buttons below to add a reply or flag this as high urgency.",
    ].join("\n"),
    footer: { text: "Gatherly Support" },
  };
}

// A staff reply, delivered to the opener. Deliberately omits staff name and URLs.
export function dmStaffReplyEmbed(text) {
  return {
    title: "New reply from the Gatherly Support Team",
    color: BRAND.color,
    thumbnail: thumb,
    description: [
      `> ${String(text).slice(0, 1500)}`,
      "",
      "- Tap Reply to respond.",
      "- Please be patient and avoid sending repeated messages.",
    ].join("\n"),
    footer: { text: "Gatherly Support" },
  };
}

// Closing embed. Clean, final, no buttons.
export function dmResolvedEmbed() {
  return {
    title: "Request resolved",
    color: BRAND.green,
    thumbnail: thumb,
    description: [
      "A member of our team has handled your request, so this thread will not be continued.",
      "",
      "- Thank you for reaching out to Gatherly.",
      "- You are welcome to open a new request any time from the Gatherly website.",
    ].join("\n"),
    footer: { text: "Gatherly Support" },
  };
}

/* --------------------------- Discord senders ---------------------------- */
// Posts the ticket card to the staff channel; returns the created message id.
export async function sendChannelCard(t) {
  if (!process.env.DISCORD_BOT_TOKEN) return { ok: false };
  try {
    const r = await discordBotFetch(`/channels/${SUPPORT_CHANNEL_ID}/messages`, {
      method: "POST", body: JSON.stringify({ embeds: [channelEmbed(t)], components: channelComponents(t) }),
    });
    if (!r.ok) return { ok: false };
    const m = await r.json();
    return { ok: true, messageId: m.id, channelId: SUPPORT_CHANNEL_ID };
  } catch { return { ok: false }; }
}

// Best-effort refresh of the channel card after a state change.
export async function refreshChannelCard(t) {
  if (!t.channelMessageId || !t.channelId || !process.env.DISCORD_BOT_TOKEN) return false;
  try {
    const r = await discordBotFetch(`/channels/${t.channelId}/messages/${t.channelMessageId}`, {
      method: "PATCH", body: JSON.stringify({ embeds: [channelEmbed(t)], components: channelComponents(t) }),
    });
    return r.ok;
  } catch { return false; }
}

// A plain follow-up line in the channel (e.g. a user's relayed reply).
export async function postChannelNote(t, line) {
  if (!process.env.DISCORD_BOT_TOKEN) return false;
  try {
    const r = await discordBotFetch(`/channels/${t.channelId || SUPPORT_CHANNEL_ID}/messages`, {
      method: "POST", body: JSON.stringify({ embeds: [{ color: t.escalated ? BRAND.yellow : BRAND.color, description: `### Ticket \`${t.id}\`\n${line}`, footer: { text: "Gatherly Support" }, timestamp: new Date().toISOString() }] }),
    });
    return r.ok;
  } catch { return false; }
}

export async function dmOpened(t) { return t.discordId ? dmUserEmbed(t.discordId, dmOpenedEmbed(t), dmComponents(t)) : { ok: false }; }
export async function dmStaffReply(t, text) { return t.discordId ? dmUserEmbed(t.discordId, dmStaffReplyEmbed(text), dmComponents(t)) : { ok: false }; }
export async function dmResolved(t) { return t.discordId ? dmUserEmbed(t.discordId, dmResolvedEmbed(), null) : { ok: false }; }

/* --------------------------- staff resolution --------------------------- */
export async function discordUserIsStaff(discordId) {
  if (!discordId) return false;
  const u = await usersStore().get(`dsc_${discordId}`, { type: "json" });
  return isStaff(u);
}

export { effectivePlan };
