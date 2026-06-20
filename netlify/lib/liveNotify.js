// netlify/lib/liveNotify.js
// Sends a Discord notification, with a per-scenario role ping, the moment a
// boosted (credit-spent) Ultra-plan event goes live. Posted to the fixed
// event-announcements channel, using Components V2 so the banner, description,
// and quick-join button render as a clean card instead of a classic embed.
import { usersStore, discordBotFetch, effectivePlan, BRAND, decrypt } from "./util.js";
import { text, separator, container, actionRow, linkButton, GATHERLY_EMOJI_TAG, V2_FLAG } from "./broadcast.js";

const SITE_URL = process.env.SITE_URL || "https://gatherly-erlc.xyz";

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

export function liveNotifyPayload(ev, host) {
  const role = roleIdFor(ev.scenario);
  const label = labelFor(ev.scenario);
  const banner = bannerUrl(ev);
  const joinable = isJoinUrl(ev.joinCode);

  const blocks = [
    text(`${GATHERLY_EMOJI_TAG} **${ev.title || "Gatherly Event"}** is live`),
    text([
      `**Scenario:** ${label}`,
      `**Host:** ${host?.username || ev.hostUsername || "Unknown"}`,
    ].join("\n")),
  ];
  if (ev.description) {
    blocks.push(separator());
    blocks.push(text(`> ${String(ev.description).slice(0, 1000)}`));
  }
  if (banner) {
    blocks.push({ type: 12, items: [{ media: { url: banner } }] });
  }
  blocks.push(separator());
  blocks.push(text("-# Boosted listing, posted automatically when the event went live."));

  const card = container(blocks, BRAND.color);
  const buttons = [];
  if (joinable) buttons.push(linkButton("Quick Join", ev.joinCode.trim(), { emoji: { name: "🚓" } }));

  return {
    content: `<@&${role}>`,
    allowed_mentions: { roles: [role] },
    flags: V2_FLAG,
    components: buttons.length ? [card, actionRow(buttons)] : [card],
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
  try {
    const r = await discordBotFetch(`/channels/${LIVE_NOTIFY_CHANNEL_ID}/messages`, {
      method: "POST",
      body: JSON.stringify(liveNotifyPayload(ev, host)),
    });
    if (!r.ok) {
      // Discord puts the actual cause (bad permissions, malformed component,
      // unknown channel, etc) in the response body, not just the status code.
      let detail = "";
      try { detail = await r.text(); } catch {}
      console.log(`[liveNotify] Discord rejected the message for event ${ev.id}: status ${r.status}, body: ${detail.slice(0, 500)}`);
      return { ok: false, reason: `discord-${r.status}`, detail: detail.slice(0, 500) };
    }
    return { ok: true };
  } catch (e) {
    console.log(`[liveNotify] network error sending for event ${ev.id}: ${e?.message || e}`);
    return { ok: false, reason: "network-error", detail: e?.message || String(e) };
  }
}

export async function hostFor(ev) {
  if (!ev?.userId) return null;
  return usersStore().get(ev.userId, { type: "json" });
}

// decrypt is re-exported for symmetry with events.js's own ER:LC key handling,
// unused here directly but kept available for any future quick-join fallback
// that needs the raw server key rather than the public share link.
export { decrypt };
