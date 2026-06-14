// Shared support helpers used by /api/tickets and /api/interactions.
// Embeds v2 throughout. Report DM includes a link button to the website report.
import {
  ticketsStore, usersStore, BRAND, discordBotFetch, dmUserEmbed,
  isStaff, effectivePlan, planName,
} from "./util.js";

export const SUPPORT_CHANNEL_ID = process.env.SUPPORT_CHANNEL_ID || "1515235842292187246";
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

/* ------------------------------- embeds v2 ------------------------------ */
// Helper: build an embeds v2 message body with optional link button.
function v2Message(components, linkButton = null) {
  const rows = [...components];
  if (linkButton) {
    rows.push({
      type: 1,
      components: [linkButton],
    });
  }
  return { components: rows, flags: 32768 }; // 32768 = IS_COMPONENTS_V2
}

// Container component (type 17) - the glass card wrapper for embeds v2.
function container(color, children) {
  return { type: 17, accent_color: color, components: children };
}

// Section with text (type 9).
function section(text) {
  return { type: 9, components: [{ type: 10, content: text }] };
}

// Text display (type 10).
function textBlock(content) {
  return { type: 10, content };
}

// Separator (type 14).
const sep = () => ({ type: 14, divider: true, spacing: 1 });

// Big blue link button.
function reportButton(label, url) {
  return { type: 2, style: 5, label, url };
}

/* -------------------- staff channel card (embeds v2) -------------------- */
export function channelEmbed(t) {
  const color = t.status === "closed" ? 0x9aa4b2 : t.escalated ? BRAND.yellow : t.assignedTo ? BRAND.green : BRAND.red;
  const statusText = t.status === "closed" ? "Closed" : t.escalated ? "Escalated - high urgency" : t.assignedTo ? `Claimed by ${t.assignedToName}` : "Open, unclaimed";
  const first = (t.messages?.find((m) => m.from === "user")?.text || "").slice(0, 1000);
  return {
    title: "Gatherly Support",
    color,
    description: [
      `### ${t.subject}`,
      `> ${first || "No message provided."}`,
      "",
      `**Topic:** ${t.topic}`,
      `**Plan:** ${planName(t.plan || "free")}`,
      `**Status:** ${statusText}`,
      `**Ticket:** \`${t.id}\``,
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

export function dmComponents(t) {
  return [{
    type: 1,
    components: [
      { type: 2, style: 1, label: "Reply",    custom_id: `tkt:reply:${t.id}` },
      { type: 2, style: 4, label: "Escalate", custom_id: `tkt:esc:${t.id}` },
    ],
  }];
}

/* -------------------- user-facing DM embeds (v2) ------------------------ */
export function dmOpenedPayload(t) {
  return {
    embeds: [{
      title: "# Gatherly Support",
      color: BRAND.color,
      description: [
        "> Thanks for reaching out. Our team has your request and will respond here.",
        "",
        "### Your inquiry",
        `> ${t.subject}`,
        "",
        "**What happens next**",
        "> A member of our team will reply to this DM shortly.",
        "> Please be patient and avoid sending repeated messages.",
        "> Use the buttons below to add a reply or flag this as high urgency.",
      ].join("\n"),
      footer: { text: "Gatherly Support" },
      timestamp: new Date().toISOString(),
    }],
    components: dmComponents(t),
  };
}

export function dmStaffReplyPayload(text) {
  return {
    embeds: [{
      title: "# Reply from Gatherly Support",
      color: BRAND.color,
      description: [
        `> ${String(text).slice(0, 1500)}`,
        "",
        "**Options**",
        "> Tap **Reply** below to respond to this message.",
        "> Please be patient and avoid sending repeated messages.",
      ].join("\n"),
      footer: { text: "Gatherly Support" },
      timestamp: new Date().toISOString(),
    }],
    components: [{
      type: 1,
      components: [
        { type: 2, style: 1, label: "Reply", custom_id: `tkt:reply:placeholder` },
      ],
    }],
  };
}

export function dmResolvedPayload() {
  return {
    embeds: [{
      title: "# Request Resolved",
      color: BRAND.green,
      description: [
        "> A member of our team has resolved your request.",
        "",
        "**Thank you for reaching out to Gatherly.**",
        "> You are welcome to open a new request any time from the Gatherly website.",
      ].join("\n"),
      footer: { text: "Gatherly Support" },
      timestamp: new Date().toISOString(),
    }],
  };
}

/* -------------------- report DM (embeds v2 with button) ---------------- */
export function reportDmPayload(ev, report, eventId) {
  const scoreColor = report.score >= 70 ? BRAND.green : report.score >= 45 ? BRAND.color : BRAND.red;
  const scoreEmoji = report.score >= 70 ? "🟢" : report.score >= 45 ? "🟡" : "🔴";
  const reportUrl = `${SITE_URL}/reports?event=${eventId}`;

  return {
    embeds: [{
      title: `# Report Ready: ${ev.title}`,
      color: scoreColor,
      description: [
        `### ${report.serverName}`,
        `> ${report.aiSummary ? report.aiSummary.slice(0, 600) : "Your event has been analysed by Gatherly."}`,
        "",
        "**Event Summary**",
        `> ${scoreEmoji} **Health score:** ${report.score}/100`,
        `> **Players joined:** ${report.uniquePlayers}`,
        `> **Peak in-server:** ${report.peakConcurrent}/${report.maxPlayers}`,
        `> **Retained 30 min:** ${report.retained30}`,
        `> **Avg session:** ${report.avgSessionMin} min`,
        "",
        report.momentum
          ? `**Momentum:** ${report.momentum.direction === "up" ? "📈" : "📉"} ${report.momentum.changePct}% vs last event`
          : "",
        "",
        "*Full analytics, charts, and staff data are available on your report page.*",
      ].filter((l) => l !== "").join("\n"),
      footer: { text: "Gatherly Analytics" },
      timestamp: new Date().toISOString(),
    }],
    components: [{
      type: 1,
      components: [{
        type: 2,
        style: 5,
        label: "View Full Report",
        url: reportUrl,
        emoji: { name: "📊" },
      }],
    }],
  };
}

/* --------------------------- Discord senders ---------------------------- */
export async function sendChannelCard(t) {
  if (!process.env.DISCORD_BOT_TOKEN) return { ok: false };
  try {
    const r = await discordBotFetch(`/channels/${SUPPORT_CHANNEL_ID}/messages`, {
      method: "POST",
      body: JSON.stringify({ embeds: [channelEmbed(t)], components: channelComponents(t) }),
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
      body: JSON.stringify({ embeds: [channelEmbed(t)], components: channelComponents(t) }),
    });
    return r.ok;
  } catch { return false; }
}

export async function postChannelNote(t, line) {
  if (!process.env.DISCORD_BOT_TOKEN) return false;
  try {
    const r = await discordBotFetch(`/channels/${t.channelId || SUPPORT_CHANNEL_ID}/messages`, {
      method: "POST",
      body: JSON.stringify({
        embeds: [{
          color: t.escalated ? BRAND.yellow : BRAND.color,
          description: `### Ticket \`${t.id}\`\n${line}`,
          footer: { text: "Gatherly Support" },
          timestamp: new Date().toISOString(),
        }],
      }),
    });
    return r.ok;
  } catch { return false; }
}

// Send opening DM with v2 payload.
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
    // Update custom_id with real ticket id.
    const payload = dmStaffReplyPayload(text);
    if (payload.components?.[0]?.components?.[0]) {
      payload.components[0].components[0].custom_id = `tkt:reply:${t.id}`;
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
