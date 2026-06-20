// netlify/lib/liveNotify.js
// Sends a Discord notification, with a per-scenario role ping, the moment a
// boosted (credit-spent) Ultra-plan event goes live. Posted to the fixed
// event-announcements channel, using Components V2 so the banner, description,
// and quick-join button render as a clean card instead of a classic embed.
//
// The card is then kept current: a scheduled job edits it once a minute with
// a fresh in-server player count for as long as the event is live, since
// Discord buttons can't self-update, the count has to be re-sent.
import { usersStore, eventsStore, discordBotFetch, effectivePlan, decrypt } from "./util.js";
import {
  text, separator, container, actionRow, linkButton, actionButton, BSTYLE,
  GATHERLY_EMOJI_TAG, V2_FLAG,
} from "./broadcast.js";

const SITE_URL = process.env.SITE_URL || "https://gatherly-erlc.xyz";
const ERLC_BASE = "https://api.erlc.gg/v1";
const PLAYER_CAP = 200;

// Fixed destination: guild 1513859432109445181, channel 1517759589993550025.
export const LIVE_NOTIFY_CHANNEL_ID = process.env.LIVE_NOTIFY_CHANNEL_ID || "1517759589993550025";

// Scenario dropdown values -> the role to ping for that scenario.
// Keys match the <option value="..."> in advertise.html exactly.
export const SCENARIO_ROLE_IDS = {
  "border-patrol": "1517757276050558986",
  "pursuit": "1517757302113964092",
  "court-trial": "1517757421655818300",
  "weather-hazard": "1517757340210696252",
  "department-tryout": "1517757475808481442",
  "miscellaneous-event": "1517757552748662965",
};

export const SCENARIO_LABELS = {
  "border-patrol": "Border Patrol",
  "pursuit": "Pursuit",
  "court-trial": "Court Trial",
  "weather-hazard": "Weather Hazard",
  "department-tryout": "Department Tryout",
  "miscellaneous-event": "Miscellaneous Event",
};

const roleIdFor = (scenario) => SCENARIO_ROLE_IDS[scenario] || SCENARIO_ROLE_IDS["miscellaneous-event"];
const labelFor = (scenario) => SCENARIO_LABELS[scenario] || "Miscellaneous Event";

// Only a real https Roblox share link can become a Discord link button (Discord
// rejects non-URL button targets outright), so anything else is treated as not
// quick-joinable and the button is simply omitted rather than sending a broken one.
const isJoinUrl = (v) => typeof v === "string" && /^https:\/\//i.test(v.trim());

function bannerUrl(ev) {
  if (ev.bannerId) return `${SITE_URL}/api/image?id=${ev.bannerId}`;
  if (ev.bannerUrl) return ev.bannerUrl;
  return null;
}

/* =========================================================================
   LIVE PLAYER COUNT PROBE
   Mirrors erlc.js's own erlcGet/getStoredKey pattern (not imported from
   there since that file's helpers are private, kept local and identical in
   shape so a scheduled job with no request context can still read it).
   ========================================================================= */
async function fetchT(url, opts = {}, ms = 7000) {
  return fetch(url, { ...opts, signal: AbortSignal.timeout(ms) });
}
function getStoredKey(host) {
  if (!host?.erlcKeyEnc) return null;
  try { return String(decrypt(host.erlcKeyEnc) || "").replace(/[\u200B-\u200D\uFEFF"'`]/g, "").trim(); } catch { return null; }
}
export async function fetchLivePlayerCount(host) {
  const key = getStoredKey(host);
  if (!key) return null;
  try {
    const [serverRes, playersRes] = await Promise.all([
      fetchT(`${ERLC_BASE}/server`, { headers: { "server-key": key, Accept: "application/json" } }),
      fetchT(`${ERLC_BASE}/server/players`, { headers: { "server-key": key, Accept: "application/json" } }),
    ]);
    if (!serverRes.ok || !playersRes.ok) return null;
    const server = await serverRes.json();
    const players = await playersRes.json();
    const playerCount = Math.min(PLAYER_CAP, Array.isArray(players) ? players.length : 0);
    const maxPlayers = Math.min(PLAYER_CAP, Number(server?.MaxPlayers) || 40);
    return { playerCount, maxPlayers };
  } catch { return null; }
}

/* =========================================================================
   V2 CARD
   ========================================================================= */
export function liveNotifyPayload(ev, host, liveCount) {
  const role = roleIdFor(ev.scenario);
  const label = labelFor(ev.scenario);
  const banner = bannerUrl(ev);
  const joinable = isJoinUrl(ev.joinCode);
  const countLabel = liveCount ? `${liveCount.playerCount}/${liveCount.maxPlayers}` : "-- / --";

  const blocks = [
    text([
      `# ${GATHERLY_EMOJI_TAG} ${label}!`,
      `> \`-\` *${ev.title || "An event"}* is live!`,
      ev.description ? `> \`-\` ${String(ev.description).slice(0, 300)}` : "",
    ].filter(Boolean).join("\n")),
    separator(),
    text([
      `\`-\` Scenario: *${label}`,
      `\`-\` Host: ${host?.username || ev.hostUsername || "Unknown"}`,
    ].join("\n")),
    separator(),
  ];
  if (banner) blocks.push({ type: 12, items: [{ media: { url: banner } }] });
  blocks.push(text([
    "-# `-` Boosted listing, posted automatically when the event went live.",
    `-# \`-\` This feature is only unlocked for Gatherly Ultra members, purchase [here](${SITE_URL}/pricing)`,
  ].join("\n")));
  blocks.push(separator());

  const buttons = [];
  if (joinable) buttons.push(linkButton("Quick Join", ev.joinCode.trim(), { emoji: { name: "🚓" } }));
  buttons.push(actionButton("Unsubscribe", `role:remove:${role}`, BSTYLE.DANGER));
  buttons.push(actionButton(countLabel, `live:count:${ev.id}`, BSTYLE.SUCCESS, { disabled: true }));
  blocks.push(actionRow(buttons));

  const card = container(blocks, 0x7fa8ff);

  // Components V2 messages reject the legacy top-level `content` field
  // outright, so the role ping has to live inside the component tree as its
  // own Text Display instead, with allowed_mentions still controlling who
  // actually gets pinged.
  return {
    allowed_mentions: { roles: [role] },
    flags: V2_FLAG,
    components: [text(`<@&${role}>`), card],
  };
}

// Gate: only Ultra-plan hosts, and only events that actually cost a credit
// (boosted). Free/Pro hosts and non-boosted listings never trigger this,
// regardless of scenario or timing.
export function eligibleForLiveNotify(ev, host) {
  if (!ev || !ev.boosted) return false;
  if (!host) return false;
  return effectivePlan(host) === "ultra";
}

export async function sendLiveNotify(ev, host) {
  if (!process.env.DISCORD_BOT_TOKEN) return { ok: false, reason: "bot-not-configured" };
  const liveCount = await fetchLivePlayerCount(host);
  try {
    const r = await discordBotFetch(`/channels/${LIVE_NOTIFY_CHANNEL_ID}/messages`, {
      method: "POST",
      body: JSON.stringify(liveNotifyPayload(ev, host, liveCount)),
    });
    if (!r.ok) {
      // Discord puts the actual cause (bad permissions, malformed component,
      // unknown channel, etc) in the response body, not just the status code.
      let detail = "";
      try { detail = await r.text(); } catch {}
      console.log(`[liveNotify] Discord rejected the message for event ${ev.id}: status ${r.status}, body: ${detail.slice(0, 500)}`);
      return { ok: false, reason: `discord-${r.status}`, detail: detail.slice(0, 500) };
    }
    const m = await r.json();
    return { ok: true, messageId: m.id };
  } catch (e) {
    console.log(`[liveNotify] network error sending for event ${ev.id}: ${e?.message || e}`);
    return { ok: false, reason: "network-error", detail: e?.message || String(e) };
  }
}

// Re-edits the already-sent card with a fresh player count. Used by the
// per-minute scheduled refresh while the event is still live.
export async function refreshLiveNotify(ev, host) {
  if (!process.env.DISCORD_BOT_TOKEN || !ev.liveCardMessageId) return { ok: false, reason: "no-message" };
  const liveCount = await fetchLivePlayerCount(host);
  try {
    const r = await discordBotFetch(`/channels/${LIVE_NOTIFY_CHANNEL_ID}/messages/${ev.liveCardMessageId}`, {
      method: "PATCH",
      body: JSON.stringify(liveNotifyPayload(ev, host, liveCount)),
    });
    if (!r.ok) {
      let detail = "";
      try { detail = await r.text(); } catch {}
      return { ok: false, reason: `discord-${r.status}`, detail: detail.slice(0, 500) };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: "network-error", detail: e?.message || String(e) };
  }
}

export async function hostFor(ev) {
  if (!ev?.userId) return null;
  return usersStore().get(ev.userId, { type: "json" });
}

export { eventsStore };
