// netlify/lib/broadcast.js
// Discord DM Broadcast system. Lets an executive notify every Gatherly user
// who has linked their Discord account, using Discord's Components V2
// message format (the rounded "container" cards, not classic embeds).
//
// Also owns the public, no-login unsubscribe link that ships inside every
// broadcast DM. The link is a signed token (HMAC over the user id) so it
// works straight from Discord on any device without the user having to be
// logged into the site.
import crypto from "node:crypto";
import {
  usersStore, miscStore, discordBotFetch, clampStr, id, audit,
} from "./util.js";

const SITE_URL = process.env.SITE_URL || "https://gatherly-erlc.xyz";
export const GATHERLY_EMOJI = { name: "gatherly", id: "1515856827689205972" };
export const GATHERLY_EMOJI_TAG = `<:${GATHERLY_EMOJI.name}:${GATHERLY_EMOJI.id}>`;

/* =========================================================================
   COMPONENTS V2 BUILDERS
   ========================================================================= */
// Discord's Components V2 system replaces the classic `embeds` array with a
// `components` tree and the message flag IS_COMPONENTS_V2 (1 << 15). This is
// what produces the rounded-corner "container" cards with proper heading
// support, separators, and accessory buttons, the look in the reference
// screenshot. Classic embed description strings like "### Title" only ever
// rendered as literal hashes because embed descriptions are not full
// markdown surfaces, V2 Text Display components are.
export const V2_FLAG = 1 << 15; // IS_COMPONENTS_V2

const CTYPE = {
  ACTION_ROW: 1, BUTTON: 2, TEXT_DISPLAY: 10, SECTION: 9,
  THUMBNAIL: 11, MEDIA_GALLERY: 12, SEPARATOR: 14, CONTAINER: 17,
};
const BSTYLE = { PRIMARY: 1, SECONDARY: 2, SUCCESS: 3, DANGER: 4, LINK: 5 };

export const text = (content) => ({ type: CTYPE.TEXT_DISPLAY, content: String(content).slice(0, 4000) });
export const separator = (spacing = 1, divider = true) => ({ type: CTYPE.SEPARATOR, spacing, divider });

export function linkButton(label, url, opts = {}) {
  return { type: CTYPE.BUTTON, style: BSTYLE.LINK, label: clampStr(label, 80) || "Open", url, ...(opts.emoji ? { emoji: opts.emoji } : {}) };
}
export function actionButton(label, customId, style = BSTYLE.PRIMARY, opts = {}) {
  return { type: CTYPE.BUTTON, style, label: clampStr(label, 80) || "Button", custom_id: customId, ...(opts.emoji ? { emoji: opts.emoji } : {}) };
}
export const actionRow = (components) => ({ type: CTYPE.ACTION_ROW, components });

// A rounded "container" card, the V2 equivalent of an embed, with an accent
// colour bar down the left edge.
export function container(components, color) {
  return { type: CTYPE.CONTAINER, accent_color: color, components };
}

/* =========================================================================
   UNSUBSCRIBE TOKENS
   ========================================================================= */
// Stateless, signed, no-login. Format: <userId>.<sig>. Verified with a
// constant-time compare so the link works from any device straight out of
// Discord, the same pattern the session cookie already uses in util.js.
function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET env var is not set");
  return s;
}

export function makeUnsubToken(userId) {
  const sig = crypto.createHmac("sha256", secret()).update(`unsub:${userId}`).digest("base64url");
  return `${userId}.${sig}`;
}

export function verifyUnsubToken(token) {
  const [userId, sig] = String(token || "").split(".");
  if (!userId || !sig) return null;
  const expect = crypto.createHmac("sha256", secret()).update(`unsub:${userId}`).digest("base64url");
  try { if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null; } catch { return null; }
  return userId;
}

export const unsubLink = (userId) => `${SITE_URL}/api/broadcast?action=unsubscribe&token=${encodeURIComponent(makeUnsubToken(userId))}`;

/* =========================================================================
   SUBSCRIPTION STATE
   ========================================================================= */
export const isUnsubscribed = (u) => Boolean(u?.dmNotifications?.unsubscribed);

export async function setUnsubscribed(userId, unsubscribed) {
  const store = usersStore();
  const u = await store.get(userId, { type: "json" });
  if (!u) return false;
  await store.setJSON(userId, {
    ...u,
    dmNotifications: { unsubscribed, at: new Date().toISOString() },
    updatedAt: new Date().toISOString(),
  });
  return true;
}

/* =========================================================================
   BROADCAST PAYLOAD
   ========================================================================= */
// `payload` shape from the admin form:
//   { title, body, image?, changeLogText?, changeLogUrl? }
// `userId` is the recipient's Gatherly user id (dsc_<discordId>), used to
// build their personal unsubscribe link.
export function broadcastPayload({ title, body, image, changeLogText, changeLogUrl }, userId) {
  const blocks = [
    text(`${GATHERLY_EMOJI_TAG} **${clampStr(title, 256) || "Gatherly Update"}**`),
  ];
  if (body) blocks.push(text(clampStr(body, 3500)));
  if (image && /^https?:\/\//i.test(image)) {
    blocks.push({ type: CTYPE.MEDIA_GALLERY, items: [{ media: { url: image } }] });
  }
  blocks.push(separator());
  blocks.push(text(`-# © Gatherly ${new Date().getFullYear()} | ER:LC Events & Analytics`));

  const card = container(blocks, 0x7fa8ff);

  const buttons = [];
  if (changeLogUrl && /^https?:\/\//i.test(changeLogUrl)) {
    buttons.push(linkButton(clampStr(changeLogText, 80) || "View Full Change Log", changeLogUrl));
  }
  buttons.push(linkButton("Unsubscribe from Product Updates", unsubLink(userId)));

  return {
    flags: V2_FLAG,
    components: [card, actionRow(buttons)],
  };
}

/* =========================================================================
   SENDING
   ========================================================================= */
async function openDm(discordId) {
  const ch = await discordBotFetch("/users/@me/channels", { method: "POST", body: JSON.stringify({ recipient_id: discordId }) });
  if (!ch.ok) return null;
  const { id: channelId } = await ch.json();
  return channelId;
}

export async function sendBroadcastToDiscordId(discordId, payload) {
  if (!process.env.DISCORD_BOT_TOKEN || !discordId) return { ok: false, reason: "bot-not-configured" };
  try {
    const channelId = await openDm(discordId);
    if (!channelId) return { ok: false, reason: "dm-blocked" };
    const r = await discordBotFetch(`/channels/${channelId}/messages`, { method: "POST", body: JSON.stringify(payload) });
    if (!r.ok) return { ok: false, reason: `discord-${r.status}` };
    return { ok: true };
  } catch { return { ok: false, reason: "network-error" }; }
}

export async function allConnectedUsers() {
  const store = usersStore();
  const { blobs } = await store.list();
  const all = await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })));
  return all.filter((u) => u && u.discordId);
}

// Sends to every connected, non-unsubscribed user. Runs with a small
// concurrency cap so it does not hammer Discord's per-route rate limit on
// large user bases. Persists a run record so the Control Room can show
// "last broadcast" history.
const CONCURRENCY = 5;

export async function sendBroadcastToAll(formInput, actor) {
  const users = (await allConnectedUsers()).filter((u) => !isUnsubscribed(u));
  let sent = 0, failed = 0, skipped = 0;
  const failures = [];

  let i = 0;
  async function worker() {
    while (i < users.length) {
      const u = users[i++];
      const payload = broadcastPayload(formInput, u.id);
      const r = await sendBroadcastToDiscordId(u.discordId, payload);
      if (r.ok) sent++;
      else { failed++; failures.push({ userId: u.id, username: u.username, reason: r.reason }); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, users.length) }, worker));

  const allUsers = await allConnectedUsers();
  skipped = allUsers.length - users.length;

  const run = {
    id: id().slice(0, 8),
    title: formInput.title,
    by: actor.username,
    at: new Date().toISOString(),
    sent, failed, skipped, total: allUsers.length,
    failures: failures.slice(0, 25),
  };
  const runs = (await miscStore().get("broadcastRuns", { type: "json" })) || [];
  runs.unshift(run);
  await miscStore().setJSON("broadcastRuns", runs.slice(0, 50));
  await audit(actor, "broadcast.send", { title: formInput.title, sent, failed, skipped, total: allUsers.length });

  return run;
}

export async function sendBroadcastTest(formInput, testDiscordId, actor) {
  // Self-test uses a throwaway userId tag so the unsubscribe button in the
  // test DM is clearly inert and never touches a real account's prefs.
  const payload = broadcastPayload(formInput, `test_${testDiscordId}`);
  const r = await sendBroadcastToDiscordId(testDiscordId, payload);
  await audit(actor, "broadcast.test", { title: formInput.title, testDiscordId, ok: r.ok, reason: r.reason || null });
  return r;
}

export async function listBroadcastRuns() {
  return (await miscStore().get("broadcastRuns", { type: "json" })) || [];
}
