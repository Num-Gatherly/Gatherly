// Shared support helpers used by /api/tickets and /api/interactions.
//
// Rewritten on Components V2 (the rounded "container" cards). Classic embed
// description strings like "### Title" only ever rendered as literal
// hashes in DMs and the staff channel, because embed descriptions are not
// a full markdown surface, V2 Text Display components are. This file now
// builds every support message the same way the DM broadcast system does.
import {
  ticketsStore, usersStore, BRAND, discordBotFetch,
  isStaff, effectivePlan, planName,
} from "./util.js";
import {
  text, separator, container, actionRow, actionButton, linkButton,
  GATHERLY_EMOJI_TAG, V2_FLAG,
} from "./broadcast.js";

export const SUPPORT_CHANNEL_ID = process.env.SUPPORT_CHANNEL_ID || "1515235842292187246";
export const SUPPORT_PING_ROLE_ID = process.env.SUPPORT_PING_ROLE_ID || "1514879974643990698";
const SITE_URL = process.env.SITE_URL || "https://gatherly-erlc.xyz";
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

/* ------------------------------- V2 cards -------------------------------- */
// Staff-facing ticket card, posted in the support channel. Same V2 shape as
// the DM cards below so the heading and quote-block markdown actually
// renders instead of showing as literal "#" characters.
export function channelEmbed(t) {
  const color = t.status === "closed" ? 0x9aa4b2 : t.escalated ? BRAND.yellow : t.assignedTo ? BRAND.green : BRAND.red;
  const statusText = t.status === "closed" ? "Closed" : t.escalated ? "Escalated, high urgency" : t.assignedTo ? `Claimed by ${t.assignedToName}` : "Open, unclaimed";
  const first = (t.messages?.find((m) => m.from === "user")?.text || "").slice(0, 1000);
  const blocks = [
    text(`${GATHERLY_EMOJI_TAG} **Gatherly Support**`),
    text([
      `### ${t.subject}`,
      `> ${first || "No message provided."}`,
    ].join("\n")),
    separator(),
    text([
      `**Topic:** ${t.topic}`,
      `**Plan:** ${planName(t.plan || "free")}`,
      `**Status:** ${statusText}`,
      `**Ticket:** \`${t.id}\``,
    ].join("\n")),
  ];
  return container(blocks, color);
}

export function channelComponents(t) {
  if (t.status === "closed") return [];
  return [actionRow([
    actionButton("Claim", `tkt:claim:${t.id}`, 3),
    actionButton("Unclaim", `tkt:unclaim:${t.id}`, 2),
    actionButton("Close", `tkt:close:${t.id}`, 4),
    actionButton("Escalate", `tkt:esc:${t.id}`, 1),
  ])];
}

export function dmComponents(t) {
  return [actionRow([
    actionButton("Reply", `tkt:reply:${t.id}`, 1),
    actionButton("Escalate", `tkt:esc:${t.id}`, 4),
  ])];
}

/* -------------------- user-facing DM cards -------------------- */
export function dmOpenedPayload(t) {
  const blocks = [
    text(`${GATHERLY_EMOJI_TAG} **Gatherly Support**`),
    text([
      "> Thanks for reaching out. Our team has your request and will respond here.",
    ].join("\n")),
    separator(),
    text([
      "### Your inquiry",
      `> ${t.subject}`,
    ].join("\n")),
    separator(),
    text([
      "**What happens next**",
      "> A member of our team will reply to this DM shortly.",
      "> Please be patient and avoid sending repeated messages.",
      "> Use the buttons below to add a reply or flag this as high urgency.",
    ].join("\n")),
  ];
  return {
    flags: V2_FLAG,
    components: [container(blocks, BRAND.color), ...dmComponents(t)],
  };
}

export function dmStaffReplyPayload(text_) {
  const blocks = [
    text(`${GATHERLY_EMOJI_TAG} **Reply from Gatherly Support**`),
    text(`> ${String(text_).slice(0, 1500)}`),
    separator(),
    text([
      "**Options**",
      "> Tap **Reply** below to respond to this message.",
      "> Please be patient and avoid sending repeated messages.",
    ].join("\n")),
  ];
  return {
    flags: V2_FLAG,
    components: [
      container(blocks, BRAND.color),
      actionRow([actionButton("Reply", "tkt:reply:placeholder", 1)]),
    ],
  };
}

export function dmResolvedPayload() {
  const blocks = [
    text(`${GATHERLY_EMOJI_TAG} **Request Resolved**`),
    text("> A member of our team has resolved your request."),
    separator(),
    text([
      "**Thank you for reaching out to Gatherly.**",
      "> You are welcome to open a new request any time from the Gatherly website.",
    ].join("\n")),
  ];
  return {
    flags: V2_FLAG,
    components: [container(blocks, BRAND.green)],
  };
}

/* -------------------- report DM (with button) -------------------- */
export function reportDmPayload(ev, report, eventId) {
  const scoreColor = report.score >= 70 ? BRAND.green : report.score >= 45 ? BRAND.color : BRAND.red;
  const scoreEmoji = report.score >= 70 ? "🟢" : report.score >= 45 ? "🟡" : "🔴";
  const reportUrl = `${SITE_URL}/reports?event=${eventId}`;

  const blocks = [
    text(`${GATHERLY_EMOJI_TAG} **Report Ready: ${ev.title}**`),
    text([
      `### ${report.serverName}`,
      `> ${report.aiSummary ? report.aiSummary.slice(0, 600) : "Your event has been analysed by Gatherly."}`,
    ].join("\n")),
    separator(),
    text([
      "**Event Summary**",
      `> ${scoreEmoji} **Health score:** ${report.score}/100`,
      `> **Players joined:** ${report.uniquePlayers}`,
      `> **Peak in-server:** ${report.peakConcurrent}/${report.maxPlayers}`,
      `> **Retained 30 min:** ${report.retained30}`,
      `> **Avg session:** ${report.avgSessionMin} min`,
      report.momentum ? `> **Momentum:** ${report.momentum.direction === "up" ? "📈" : "📉"} ${report.momentum.changePct}% vs last event` : "",
    ].filter((l) => l !== "").join("\n")),
    separator(),
    text("-# Full analytics, charts, and staff data are available on your report page."),
  ];

  return {
    flags: V2_FLAG,
    components: [
      container(blocks, scoreColor),
      actionRow([linkButton("View Full Report", reportUrl, { emoji: { name: "📊" } })]),
    ],
  };
}

/* --------------------------- Discord senders ---------------------------- */
export async function sendChannelCard(t) {
  if (!process.env.DISCORD_BOT_TOKEN) return { ok: false };
  try {
    // Components V2 rejects the legacy top-level `content` field outright,
    // so the staff ping has to be its own Text Display component instead.
    const pingBlock = SUPPORT_PING_ROLE_ID ? [text(`<@&${SUPPORT_PING_ROLE_ID}> - a new support ticket needs attention.`)] : [];
    const r = await discordBotFetch(`/channels/${SUPPORT_CHANNEL_ID}/messages`, {
      method: "POST",
      body: JSON.stringify({
        allowed_mentions: { roles: SUPPORT_PING_ROLE_ID ? [SUPPORT_PING_ROLE_ID] : [] },
        flags: V2_FLAG,
        components: [...pingBlock, channelEmbed(t), ...channelComponents(t)],
      }),
    });
    if (!r.ok) return { ok: false };
    const m = await r.json();
    return { ok: true, messageId: m.id, channelId: SUPPORT_CHANNEL_ID };
  } catch { return { ok: false }; }
}

export async function refreshChannelCard(t) {
  if (!t.channelMessageId || !t.channelId || !process.env.DISCORD_BOT_TOKEN) return false;
  try {
    const r = await discordBotFetch(`/channels/${t.channelId}/messages/${t.channelMessageId}`, {
      method: "PATCH",
      body: JSON.stringify({ flags: V2_FLAG, components: [channelEmbed(t), ...channelComponents(t)] }),
    });
    return r.ok;
  } catch { return false; }
}

export async function postChannelNote(t, line) {
  if (!process.env.DISCORD_BOT_TOKEN) return false;
  try {
    const blocks = [text(`### Ticket \`${t.id}\``), text(line)];
    const r = await discordBotFetch(`/channels/${t.channelId || SUPPORT_CHANNEL_ID}/messages`, {
      method: "POST",
      body: JSON.stringify({
        flags: V2_FLAG,
        components: [container(blocks, t.escalated ? BRAND.yellow : BRAND.color)],
      }),
    });
    return r.ok;
  } catch { return false; }
}

export async function dmOpened(t) {
  if (!t.discordId || !process.env.DISCORD_BOT_TOKEN) return { ok: false };
  try {
    const ch = await discordBotFetch("/users/@me/channels", {
      method: "POST", body: JSON.stringify({ recipient_id: t.discordId }),
    });
    if (!ch.ok) return { ok: false };
    const { id: channelId } = await ch.json();
    const r = await discordBotFetch(`/channels/${channelId}/messages`, {
      method: "POST", body: JSON.stringify(dmOpenedPayload(t)),
    });
    return { ok: r.ok, channelId };
  } catch { return { ok: false }; }
}

export async function dmStaffReply(t, text) {
  if (!t.discordId || !process.env.DISCORD_BOT_TOKEN) return { ok: false };
  try {
    const ch = await discordBotFetch("/users/@me/channels", {
      method: "POST", body: JSON.stringify({ recipient_id: t.discordId }),
    });
    if (!ch.ok) return { ok: false };
    const { id: channelId } = await ch.json();
    const payload = dmStaffReplyPayload(text);
    // The Reply button sits in the second top-level component (the action
    // row appended after the container), index 1.
    if (payload.components?.[1]?.components?.[0]) {
      payload.components[1].components[0].custom_id = `tkt:reply:${t.id}`;
    }
    const r = await discordBotFetch(`/channels/${channelId}/messages`, {
      method: "POST", body: JSON.stringify(payload),
    });
    return { ok: r.ok, channelId };
  } catch { return { ok: false }; }
}

export async function dmResolved(t) {
  if (!t.discordId || !process.env.DISCORD_BOT_TOKEN) return { ok: false };
  try {
    const ch = await discordBotFetch("/users/@me/channels", {
      method: "POST", body: JSON.stringify({ recipient_id: t.discordId }),
    });
    if (!ch.ok) return { ok: false };
    const { id: channelId } = await ch.json();
    const r = await discordBotFetch(`/channels/${channelId}/messages`, {
      method: "POST", body: JSON.stringify(dmResolvedPayload()),
    });
    return { ok: r.ok, channelId };
  } catch { return { ok: false }; }
}

/* --------------------------- staff resolution --------------------------- */
export async function discordUserIsStaff(discordId) {
  if (!discordId) return false;
  const u = await usersStore().get(`dsc_${discordId}`, { type: "json" });
  return isStaff(u);
}

export { effectivePlan };
